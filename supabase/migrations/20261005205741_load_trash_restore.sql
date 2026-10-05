-- Trash is a reversible operational state. Only the explicit version-checked
-- permanent-delete command removes load-owned rows; source media remains separate.
alter table public.loads
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles(id),
  add column trash_previous_status public.load_status,
  add column trash_previous_driver_id uuid references public.profiles(id),
  add column execution_reset_at timestamptz,
  add constraint loads_trash_state_check check (
    trashed_at is null or (status = 'cancelled' and current_assignment_id is null)
  );

create index loads_company_trash_idx on public.loads(company_id, trashed_at desc)
where trashed_at is not null;

-- Keep existing column positions and security-invoker behavior for older clients.
do $$
declare definition text := pg_get_viewdef('public.load_overview'::regclass, true);
begin
  execute 'create or replace view public.load_overview with (security_invoker = true) as '
    || 'select existing.*, source.trashed_at, source.trashed_by, source.trash_previous_status, '
    || 'source.trash_previous_driver_id, source.execution_reset_at from ('
    || rtrim(definition, E';\n ') || ') existing join public.loads source on source.id = existing.id';
end;
$$;

create function public.guard_trashed_load_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.trashed_at is not null and new.trashed_at is not null then
    raise exception 'LOAD_TRASHED';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_trashed_load_update() from public, anon, authenticated;
create trigger loads_trashed_update_guard before update on public.loads
for each row execute function public.guard_trashed_load_update();

-- Existing document and execution RPCs cannot mutate retained trash contents.
-- Cascaded DELETE sees no parent load and is permitted after the checked command.
create function public.guard_trashed_load_child()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_load_id uuid; is_trashed boolean; reset_at timestamptz;
begin
  if tg_table_name = 'document_versions' then
    select d.load_id into target_load_id from public.documents d
    where d.id = case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  else
    target_load_id := case when tg_op = 'DELETE' then old.load_id else new.load_id end;
  end if;
  select l.trashed_at is not null, l.execution_reset_at into is_trashed, reset_at from public.loads l
  where l.id = target_load_id for key share;
  if tg_table_name = 'document_versions' and tg_op = 'UPDATE' then
    if old.upload_lease_started_at < reset_at then
      raise exception 'LOAD_DOCUMENT_STALE';
    end if;
  end if;
  if is_trashed then
    -- Expired, unfinished upload reservations are not retained trip evidence.
    -- Let the existing housekeeping command finish without blocking its batch.
    if tg_op = 'DELETE' and tg_table_name = 'document_versions' then
      if old.upload_lease_started_at is not null and old.upload_expires_at <= now()
        and not exists (select 1 from public.documents where current_version_id = old.id) then
        return old;
      end if;
    elsif tg_op = 'DELETE' and tg_table_name = 'documents' then
      if old.current_version_id is null
        and not exists (select 1 from public.document_versions where document_id = old.id) then
        return old;
      end if;
    end if;
    raise exception 'LOAD_TRASHED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- A previous execution's ten retained PDFs must not consume the restarted
-- execution's upload allowance. Old unfinished leases cannot be committed.
do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.begin_document_upload(uuid,uuid,text,text,text,bigint)'::regprocedure);
  anchor := E'        d.current_version_id is not null\n        or exists (';
  if strpos(definition, anchor) = 0 then raise exception 'Document upload trash filter anchor missing'; end if;
  definition := replace(definition, anchor,
    E'        (d.current_version_id is not null and (target_load.execution_reset_at is null or exists (\n'
    || E'          select 1 from public.document_versions current_v where current_v.id=d.current_version_id\n'
    || E'            and current_v.uploaded_at >= target_load.execution_reset_at)))\n        or exists (');
  anchor := '            and v.upload_expires_at > now()';
  if strpos(definition, anchor) = 0 then raise exception 'Document upload lease filter anchor missing'; end if;
  execute replace(definition, anchor, anchor
    || ' and (target_load.execution_reset_at is null or v.upload_lease_started_at >= target_load.execution_reset_at)');
end;
$$;

create or replace function public.can_access_load_media_context(target_context_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.document_versions v
    join public.documents d on d.id=v.document_id join public.loads l on l.id=d.load_id
    where v.id=target_context_id and v.uploaded_by=(select auth.uid())
      and v.upload_lease_started_at is not null and v.upload_expires_at>now()
      and (l.execution_reset_at is null or v.upload_lease_started_at>=l.execution_reset_at)
      and public.can_upload_load_document(l.id));
$$;
revoke all on function public.can_access_load_media_context(uuid) from public,anon;
grant execute on function public.can_access_load_media_context(uuid) to authenticated;

-- Completing an old uploader-owned version is not sufficient authority after
-- a restore/reassignment. Check the live assignment and execution generation,
-- including retries of versions which were already finalized before trash.
do $$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array[
    'public.complete_document_upload(uuid,text)',
    'public.bind_document_version_media(uuid,text,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    anchor := '  if target_version.upload_expires_at is not null';
    if strpos(definition, anchor) = 0 then raise exception 'Document completion trash filter anchor missing: %',signature; end if;
    execute replace(definition, anchor,
      E'  if exists (select 1 from public.documents d join public.loads l on l.id=d.load_id\n'
      || E'    where d.id=target_version.document_id and l.trashed_at is not null) then\n'
      || E'    raise exception ''LOAD_TRASHED'';\n  end if;\n'
      || E'  if not exists (select 1 from public.documents d join public.loads l on l.id=d.load_id\n'
      || E'    where d.id=target_version.document_id and public.can_upload_load_document(l.id)\n'
      || E'      and (l.execution_reset_at is null or target_version.uploaded_at>=l.execution_reset_at)) then\n'
      || E'    raise exception ''LOAD_DOCUMENT_STALE'';\n  end if;\n' || anchor);
  end loop;
end;
$$;
revoke all on function public.guard_trashed_load_child() from public, anon, authenticated;
create trigger load_stops_trashed_guard before insert or update or delete on public.load_stops
for each row execute function public.guard_trashed_load_child();
create trigger assignments_trashed_guard before insert or update or delete on public.assignments
for each row execute function public.guard_trashed_load_child();
create trigger offers_trashed_guard before insert or update or delete on public.offers
for each row execute function public.guard_trashed_load_child();
create trigger documents_trashed_guard before insert or update or delete on public.documents
for each row execute function public.guard_trashed_load_child();
create trigger document_versions_trashed_guard before insert or update or delete on public.document_versions
for each row execute function public.guard_trashed_load_child();
create trigger load_accounting_trashed_guard before insert or update or delete on public.load_accounting
for each row execute function public.guard_trashed_load_child();

create function public.trash_load(target_load_id uuid, expected_version bigint)
returns public.loads language plpgsql security definer set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.loads;
  saved public.loads;
  previous_driver uuid;
  changed_at timestamptz;
begin
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'LOAD_TRASH_PERMISSION';
  end if;
  select * into target from public.loads l
  where l.id = target_load_id and l.company_id = actor.company_id for update;
  if target.id is null then raise exception 'LOAD_TRASH_NOT_FOUND'; end if;
  if target.version is distinct from expected_version then raise exception 'LOAD_TRASH_CONFLICT'; end if;
  if target.trashed_at is not null then raise exception 'LOAD_ALREADY_TRASHED'; end if;

  select a.driver_id into previous_driver from public.assignments a
  where a.id = target.current_assignment_id and a.load_id = target.id for update;
  changed_at := clock_timestamp();
  update public.assignments set status = 'cancelled', ended_at = changed_at
  where load_id = target.id and status = 'active';
  update public.driver_tracking_sessions s set ended_at = a.ended_at
  from public.assignments a where s.assignment_id = a.id and a.load_id = target.id
    and a.ended_at is not null and s.ended_at is null;
  update public.offers set status = 'withdrawn', responded_at = changed_at
  where load_id = target.id and status in ('pending','missed_offline');
  update public.push_deliveries p set status = 'cancelled', locked_at = null,
    locked_by = null, last_error = 'Load moved to trash', updated_at = changed_at
  from public.notifications n where p.notification_id = n.id
    and n.company_id = actor.company_id and p.status in ('pending','processing','failed')
    and ((n.entity_type = 'load' and n.entity_id = target.id)
      or (n.entity_type = 'offer' and n.entity_id in (select id from public.offers where load_id = target.id)));
  update public.loads set status = 'cancelled', current_assignment_id = null,
    trashed_at = changed_at, trashed_by = actor.id, trash_previous_status = target.status,
    trash_previous_driver_id = previous_driver, version = version + 1
  where id = target.id returning * into saved;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
  values(actor.company_id,actor.id,'load.trashed','load',target.id,to_jsonb(target),to_jsonb(saved));
  return saved;
end;
$$;

create function public.restore_trashed_load(target_load_id uuid, expected_version bigint, target_driver_id uuid default null)
returns public.loads language plpgsql security definer set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.loads;
  saved public.loads;
  previous_stops jsonb;
begin
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'LOAD_TRASH_PERMISSION';
  end if;
  select * into target from public.loads l
  where l.id = target_load_id and l.company_id = actor.company_id for update;
  if target.id is null then raise exception 'LOAD_TRASH_NOT_FOUND'; end if;
  if target.version is distinct from expected_version then raise exception 'LOAD_TRASH_CONFLICT'; end if;
  if target.trashed_at is null then raise exception 'LOAD_NOT_TRASHED'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence), '[]'::jsonb)
  into previous_stops from public.load_stops s where s.load_id = target.id;
  update public.loads set status = 'ready_for_offer', current_assignment_id = null,
    trashed_at = null, trashed_by = null, trash_previous_status = null, trash_previous_driver_id = null,
    cancellation_source = null, cancellation_reason = null,
    execution_reset_at = clock_timestamp(), version = version + 1
  where id = target.id;
  update public.load_stops set status = 'pending', version = version + 1 where load_id = target.id;
  -- Old assignments and GPS remain history. Direct assignment creates a new
  -- accepted assignment; an invalid driver or unreviewed document rolls all of this back.
  if target_driver_id is not null then
    perform public.assign_load_directly(target.id, target_driver_id);
  end if;
  select * into saved from public.loads where id = target.id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value,metadata)
  values(actor.company_id,actor.id,'load.restored','load',target.id,to_jsonb(target),to_jsonb(saved),
    jsonb_build_object('previous_stops',previous_stops,'execution_restarted',true));
  return saved;
end;
$$;

-- Retained BOL/POD remains viewable history but cannot prove a restarted trip.
create or replace function public.stop_has_required_document(target_stop_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.load_stops s
    join public.loads l on l.id = s.load_id and l.company_id = s.company_id
    join public.documents d on d.stop_id = s.id and d.load_id = s.load_id and d.company_id = s.company_id
      and d.document_type = public.required_document_type_for_stop(s.type) and d.current_version_id is not null
    join public.document_versions v on v.id = d.current_version_id and v.document_id = d.id
      and v.company_id = d.company_id and v.superseded_at is null
    where s.id = target_stop_id and l.trashed_at is null
      and (l.execution_reset_at is null or v.uploaded_at >= l.execution_reset_at)
  );
$$;

-- The parent is already gone during an authorized load cascade. Keep all
-- existing protections for direct document deletion while a load still exists.
create or replace function public.prevent_required_document_delete()
returns trigger language plpgsql set search_path = public
as $$
declare target_stop public.load_stops; target_load_status public.load_status;
begin
  if old.stop_id is null then return old; end if;
  select * into target_stop from public.load_stops where id = old.stop_id;
  select status into target_load_status from public.loads where id = old.load_id;
  if target_load_status is not null and target_stop.id is not null and target_stop.requires_document
    and old.current_version_id is not null
    and old.document_type = public.required_document_type_for_stop(target_stop.type)
    and (target_stop.status = 'done' or target_load_status in ('delivered','completed')) then
    raise exception using errcode = '23514', message = 'Required BOL/POD cannot be deleted after the stop is completed';
  end if;
  return old;
end;
$$;

create function public.permanently_delete_trashed_load(target_load_id uuid, expected_version bigint)
returns uuid language plpgsql security definer set search_path = public
as $$
declare actor public.profiles := public.current_profile(); target public.loads; retained_media jsonb;
begin
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'LOAD_TRASH_PERMISSION';
  end if;
  select * into target from public.loads l
  where l.id = target_load_id and l.company_id = actor.company_id for update;
  if target.id is null then raise exception 'LOAD_TRASH_NOT_FOUND'; end if;
  if target.version is distinct from expected_version then raise exception 'LOAD_TRASH_CONFLICT'; end if;
  if target.trashed_at is null then raise exception 'LOAD_NOT_TRASHED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('document_version_id',v.id,'storage_path',v.storage_path)), '[]'::jsonb)
  into retained_media from public.document_versions v join public.documents d on d.id=v.document_id
  where d.load_id=target.id;
  -- Keep independent email/import originals and chat/media records. There is no
  -- safe reference-counted blob collector here; do not enqueue shared asset deletion.
  update public.jobs set status='dead_letter',last_error='Load permanently deleted',locked_at=null,locked_by=null
  where company_id=actor.company_id and type='document.ai_check' and status in ('pending','failed','processing')
    and (payload->>'loadId'=target.id::text or payload->>'documentVersionId' in (
      select v.id::text from public.document_versions v join public.documents d on d.id=v.document_id where d.load_id=target.id));
  delete from public.notifications n where n.company_id=actor.company_id
    and ((n.entity_type='load' and n.entity_id=target.id)
      or (n.entity_type='offer' and n.entity_id in (select id from public.offers where load_id=target.id)));
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,metadata)
  values(actor.company_id,actor.id,'load.permanently_deleted','load',target.id,to_jsonb(target),
    jsonb_build_object('source_media_preserved',true,'retained_media',retained_media));
  delete from public.loads where id=target.id;
  return target.id;
end;
$$;

revoke all on function public.trash_load(uuid,bigint) from public,anon;
revoke all on function public.restore_trashed_load(uuid,bigint,uuid) from public,anon;
revoke all on function public.permanently_delete_trashed_load(uuid,bigint) from public,anon;
grant execute on function public.trash_load(uuid,bigint) to authenticated;
grant execute on function public.restore_trashed_load(uuid,bigint,uuid) to authenticated;
grant execute on function public.permanently_delete_trashed_load(uuid,bigint) to authenticated;
-- Old clients must not bypass the version-checked trash/permanent-delete flow.
revoke all on function public.delete_unassigned_load(uuid) from public,anon,authenticated;

-- Storage's direct upload policy uses this helper, independently of upload RPCs.
create or replace function public.can_upload_load_document(target_load_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.loads l where l.id = target_load_id and l.trashed_at is null)
    and case
      when public.current_app_role() in ('super_admin','company_admin','dispatcher') then
        public.can_access_load(target_load_id)
      when public.current_app_role() = 'driver' then exists (
        select 1 from public.loads l join public.assignments a on a.id=l.current_assignment_id
        where l.id=target_load_id and a.driver_id=(select auth.uid()) and a.status='active'
      )
      else false
    end;
$$;

-- Preserve the current analytics contracts, volatility and lock-free staff
-- actor lookup. Fail closed if an intervening migration changed either anchor.
do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.get_company_trip_analytics(text,text,date,date,integer,integer)'::regprocedure);
  anchor := 'where l.company_id=actor.company_id';
  if strpos(definition, anchor) = 0 then raise exception 'Company analytics trash filter anchor missing'; end if;
  execute replace(definition, anchor, anchor || ' and l.trashed_at is null');
  definition := pg_get_functiondef('public.get_driver_analytics(timestamptz,timestamptz)'::regprocedure);
  anchor := 'where a.driver_id = actor.id and a.company_id = actor.company_id';
  if strpos(definition, anchor) = 0 then raise exception 'Driver analytics trash filter anchor missing'; end if;
  execute replace(definition, anchor, anchor || ' and l.trashed_at is null');
end;
$$;
