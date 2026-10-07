-- The legacy composite-returning command is staff-only. Current driver clients
-- use advance_driver_route(), which returns status metadata, then read the
-- privacy-aware get_driver_load_rows projection. Keep the staff return contract.
create or replace function public.complete_load(load_id uuid)
returns public.loads language plpgsql security definer set search_path = public
as $$
declare actor public.profiles := public.current_profile(); result public.loads;
begin
  if actor.id is null or actor.role not in ('dispatcher','company_admin') then
    raise exception using errcode='42501', message='Use advance_driver_route to complete a driver load';
  end if;
  select * into result from public.loads where id=load_id and company_id=actor.company_id for update;
  if result.id is null or result.status <> 'delivered' then raise exception 'Load is not deliverable'; end if;
  update public.loads set status='completed',version=version+1 where id=result.id returning * into result;
  update public.assignments set status='completed',ended_at=now() where id=result.current_assignment_id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
  values(actor.company_id,actor.id,'load.completed','load',result.id,to_jsonb(result));
  return result;
end $$;
revoke all on function public.complete_load(uuid) from public,anon;
grant execute on function public.complete_load(uuid) to authenticated;

-- UID ownership alone must not keep working after suspension/offboarding.
-- Add a restrictive gate, preserving all existing role/privacy/access policies.
do $$
declare target text;
begin
  foreach target in array array['assignments','offers','driver_presence','location_snapshots',
    'client_operations','notifications','driver_tracking_sessions','driver_location_points'] loop
    execute format('alter table public.%I enable row level security',target);
    execute format('create policy active_tenant_read on public.%I as restrictive for select to authenticated
      using ((select public.current_app_role()) is not null and
        ((select public.current_app_role()) = ''super_admin'' or company_id = (select public.current_company_id())))',target);
  end loop;
end $$;

-- A Storage delete cannot run the public.documents evidence-retention trigger.
-- Require the guarded document RPC to remove every reference first. This also
-- protects older versions and non-operational originals from direct removal.
create function private.can_delete_load_document_object(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select public.current_app_role()) is not null
    and not exists(select 1 from public.document_versions v where v.storage_path=object_path);
$$;
revoke all on function private.can_delete_load_document_object(text) from public,anon;
grant execute on function private.can_delete_load_document_object(text) to authenticated;
create policy storage_load_documents_referenced_delete_guard on storage.objects
as restrictive for delete to authenticated using (
  bucket_id <> 'load-documents' or private.can_delete_load_document_object(name)
);

create or replace function public.update_driver_contact_pay_privacy(
  p_driver_id uuid,p_full_name text,p_phone text,p_rate_per_mile numeric,p_hide_rate_con boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); old_hidden boolean;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;
  if p_hide_rate_con is null then raise exception 'Privacy setting required'; end if;
  perform public.update_driver_contact_and_pay(p_driver_id,p_full_name,p_phone,p_rate_per_mile);
  select hide_rate_con into old_hidden from public.driver_pay_settings where driver_id=p_driver_id;
  update public.driver_pay_settings set hide_rate_con=p_hide_rate_con,updated_by=actor.id,updated_at=now()
    where driver_id=p_driver_id;
  if old_hidden is distinct from p_hide_rate_con then
    insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
    values(actor.company_id,actor.id,'driver.rate_con_privacy_updated','profile',p_driver_id,
      jsonb_build_object('hide_rate_con',old_hidden),jsonb_build_object('hide_rate_con',p_hide_rate_con));
    -- Trashed loads are inaccessible and immutable. A restore creates a fresh
    -- assignment and reads the current privacy setting, so no bump is needed.
    update public.assignments a set load_revision=a.load_revision+1 where a.driver_id=p_driver_id
      and exists(select 1 from public.loads l where l.id=a.load_id and l.trashed_at is null);
  end if;
end $$;
revoke all on function public.update_driver_contact_pay_privacy(uuid,text,text,numeric,boolean) from public,anon;
grant execute on function public.update_driver_contact_pay_privacy(uuid,text,text,numeric,boolean) to authenticated;
