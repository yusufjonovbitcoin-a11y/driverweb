-- Tenant-safe foreign keys and the remaining business command surface.

alter table public.profiles add constraint profiles_id_company_unique unique (id, company_id);
alter table public.gmail_connections add constraint gmail_connections_id_company_unique unique (id, company_id);
alter table public.broker_messages add constraint broker_messages_id_company_unique unique (id, company_id);
alter table public.broker_attachments add constraint broker_attachments_id_company_unique unique (id, company_id);
alter table public.ai_extractions add constraint ai_extractions_id_company_unique unique (id, company_id);
alter table public.loads add constraint loads_id_company_unique unique (id, company_id);
alter table public.load_stops add constraint load_stops_id_company_unique unique (id, company_id);
alter table public.offers add constraint offers_id_company_unique unique (id, company_id);
alter table public.assignments add constraint assignments_id_company_unique unique (id, company_id);
alter table public.documents add constraint documents_id_company_unique unique (id, company_id);
alter table public.document_versions add constraint document_versions_id_company_unique unique (id, company_id);
alter table public.document_checks add constraint document_checks_id_company_unique unique (id, company_id);

alter table public.driver_profiles
  add constraint driver_profiles_user_company_fk
  foreign key (user_id, company_id) references public.profiles(id, company_id);

alter table public.dispatcher_driver_access
  add constraint dispatcher_access_dispatcher_company_fk
  foreign key (dispatcher_id, company_id) references public.profiles(id, company_id),
  add constraint dispatcher_access_driver_company_fk
  foreign key (driver_id, company_id) references public.profiles(id, company_id);

alter table public.gmail_connections
  add constraint gmail_connections_creator_company_fk
  foreign key (created_by, company_id) references public.profiles(id, company_id);

alter table public.broker_messages
  add constraint broker_messages_connection_company_fk
  foreign key (gmail_connection_id, company_id) references public.gmail_connections(id, company_id);

alter table public.broker_attachments
  add constraint broker_attachments_message_company_fk
  foreign key (message_id, company_id) references public.broker_messages(id, company_id);

alter table public.ai_extractions
  add constraint ai_extractions_message_company_fk
  foreign key (message_id, company_id) references public.broker_messages(id, company_id),
  add constraint ai_extractions_attachment_company_fk
  foreign key (attachment_id, company_id) references public.broker_attachments(id, company_id);

alter table public.ai_extraction_fields
  add constraint ai_fields_extraction_company_fk
  foreign key (extraction_id, company_id) references public.ai_extractions(id, company_id),
  add constraint ai_fields_corrector_company_fk
  foreign key (corrected_by, company_id) references public.profiles(id, company_id);

alter table public.loads
  add constraint loads_owner_company_fk
  foreign key (owner_dispatcher_id, company_id) references public.profiles(id, company_id),
  add constraint loads_message_company_fk
  foreign key (broker_message_id, company_id) references public.broker_messages(id, company_id),
  add constraint loads_assignment_company_fk
  foreign key (current_assignment_id, company_id) references public.assignments(id, company_id)
  deferrable initially deferred;

alter table public.load_stops
  add constraint load_stops_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id);

alter table public.load_price_snapshots
  add constraint price_snapshots_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id),
  add constraint price_snapshots_creator_company_fk
  foreign key (created_by, company_id) references public.profiles(id, company_id);

alter table public.offers
  add constraint offers_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id),
  add constraint offers_driver_company_fk
  foreign key (driver_id, company_id) references public.profiles(id, company_id),
  add constraint offers_creator_company_fk
  foreign key (created_by, company_id) references public.profiles(id, company_id);

alter table public.assignments
  add constraint assignments_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id),
  add constraint assignments_driver_company_fk
  foreign key (driver_id, company_id) references public.profiles(id, company_id),
  add constraint assignments_offer_company_fk
  foreign key (offer_id, company_id) references public.offers(id, company_id),
  add constraint assignments_actor_company_fk
  foreign key (assigned_by, company_id) references public.profiles(id, company_id);

alter table public.documents
  add constraint documents_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id),
  add constraint documents_stop_company_fk
  foreign key (stop_id, company_id) references public.load_stops(id, company_id),
  add constraint documents_creator_company_fk
  foreign key (created_by, company_id) references public.profiles(id, company_id),
  add constraint documents_current_version_company_fk
  foreign key (current_version_id, company_id) references public.document_versions(id, company_id)
  deferrable initially deferred;

alter table public.document_versions
  add constraint document_versions_document_company_fk
  foreign key (document_id, company_id) references public.documents(id, company_id),
  add constraint document_versions_uploader_company_fk
  foreign key (uploaded_by, company_id) references public.profiles(id, company_id);

alter table public.document_checks
  add constraint document_checks_version_company_fk
  foreign key (document_version_id, company_id) references public.document_versions(id, company_id),
  add constraint document_checks_override_company_fk
  foreign key (overridden_by, company_id) references public.profiles(id, company_id);

alter table public.warnings
  add constraint warnings_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id),
  add constraint warnings_check_company_fk
  foreign key (document_check_id, company_id) references public.document_checks(id, company_id),
  add constraint warnings_override_company_fk
  foreign key (overridden_by, company_id) references public.profiles(id, company_id);

alter table public.driver_presence
  add constraint driver_presence_driver_company_fk
  foreign key (driver_id, company_id) references public.profiles(id, company_id);

alter table public.location_snapshots
  add constraint location_driver_company_fk
  foreign key (driver_id, company_id) references public.profiles(id, company_id),
  add constraint location_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id);

alter table public.client_operations
  add constraint operations_actor_company_fk
  foreign key (actor_id, company_id) references public.profiles(id, company_id),
  add constraint operations_load_company_fk
  foreign key (load_id, company_id) references public.loads(id, company_id);

alter table public.notifications
  add constraint notifications_recipient_company_fk
  foreign key (recipient_id, company_id) references public.profiles(id, company_id);

create or replace function public.set_dispatcher_driver_access(dispatcher_id uuid, driver_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  inserted_count integer;
begin
  if actor.id is null or actor.role not in ('company_admin', 'super_admin') then
    raise exception 'Company admin permission required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = dispatcher_id and p.company_id = actor.company_id and p.role = 'dispatcher'
  ) then raise exception 'Dispatcher not found'; end if;
  if exists (
    select 1 from unnest(driver_ids) d(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = d.id and p.company_id = actor.company_id and p.role = 'driver' and p.status = 'active'
    )
  ) then raise exception 'One or more drivers are not eligible'; end if;

  delete from public.dispatcher_driver_access a
  where a.dispatcher_id = set_dispatcher_driver_access.dispatcher_id;
  insert into public.dispatcher_driver_access(dispatcher_id, driver_id, company_id)
  select set_dispatcher_driver_access.dispatcher_id, d.id, actor.company_id
  from unnest(driver_ids) d(id);
  get diagnostics inserted_count = row_count;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'dispatcher.access_updated', 'profile', dispatcher_id,
    jsonb_build_object('driverIds', to_jsonb(driver_ids))
  );
  return inserted_count;
end;
$$;

create or replace function public.update_driver_profile(
  vehicle_type text,
  trailer_type text,
  capacity_lbs integer,
  equipment jsonb,
  hos_available_minutes integer default null
)
returns public.driver_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.driver_profiles;
begin
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;
  insert into public.driver_profiles(
    user_id, company_id, vehicle_type, trailer_type, capacity_lbs, equipment, hos_available_minutes
  ) values (
    actor.id, actor.company_id, vehicle_type, trailer_type, capacity_lbs,
    coalesce(equipment, '[]'::jsonb), hos_available_minutes
  ) on conflict (user_id) do update set
    vehicle_type = excluded.vehicle_type,
    trailer_type = excluded.trailer_type,
    capacity_lbs = excluded.capacity_lbs,
    equipment = excluded.equipment,
    hos_available_minutes = excluded.hos_available_minutes,
    updated_at = now()
  returning * into result;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'driver.profile_updated', 'profile', actor.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.withdraw_offer(offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.offers;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  update public.offers set status = 'withdrawn', responded_at = now()
  where id = offer_id and company_id = actor.company_id and status = 'pending'
  returning * into result;
  if result.id is null then raise exception 'Pending offer not found'; end if;
  if not exists (select 1 from public.offers where load_id = result.load_id and status = 'pending') then
    update public.loads set status = 'ready_for_offer', version = version + 1
    where id = result.load_id and current_assignment_id is null;
  end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'offer.withdrawn', 'offer', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.cancel_load(load_id uuid, source text, reason text)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.loads;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  if source not in ('dispatcher', 'broker') then raise exception 'Cancellation source is invalid'; end if;
  select * into result from public.loads
  where id = load_id and company_id = actor.company_id for update;
  if result.id is null or result.status in ('completed', 'cancelled') then
    raise exception 'Load cannot be cancelled';
  end if;
  update public.offers set status = 'withdrawn', responded_at = now()
  where load_id = result.id and status = 'pending';
  update public.assignments set status = 'cancelled', ended_at = now()
  where id = result.current_assignment_id and status = 'active';
  update public.loads set
    status = 'cancelled', current_assignment_id = null,
    cancellation_source = source, cancellation_reason = reason,
    version = version + 1
  where id = result.id returning * into result;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.cancelled', 'load', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.reassign_load(
  load_id uuid,
  new_driver_id uuid,
  origin_latitude numeric default null,
  origin_longitude numeric default null,
  estimated_deadhead_miles numeric default 0
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  result public.offers;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  select * into target_load from public.loads
  where id = load_id and company_id = actor.company_id for update;
  if target_load.id is null or target_load.status in ('completed', 'cancelled') then
    raise exception 'Load cannot be reassigned';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new_driver_id and p.company_id = actor.company_id and p.role = 'driver' and p.status = 'active'
  ) then raise exception 'Driver is not eligible'; end if;

  update public.assignments set status = 'reassigned', ended_at = now()
  where id = target_load.current_assignment_id and status = 'active';
  update public.loads set current_assignment_id = null, status = 'ready_for_offer', version = version + 1
  where id = target_load.id;
  select * into result from public.send_offer(
    target_load.id, new_driver_id, origin_latitude, origin_longitude,
    estimated_deadhead_miles, '[{"code":"REASSIGNMENT","message":"Load was reassigned by dispatch"}]'::jsonb
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.reassigned', 'load', target_load.id, jsonb_build_object('offerId', result.id, 'driverId', new_driver_id));
  return result;
end;
$$;

create or replace function public.update_load_terms(
  load_id uuid,
  broker_rate numeric,
  loaded_miles numeric,
  pickup_appointment_from timestamptz default null,
  pickup_appointment_to timestamptz default null,
  delivery_appointment_from timestamptz default null,
  delivery_appointment_to timestamptz default null,
  source_attachment_id uuid default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.loads;
  accepted_before boolean;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  select * into result
  from public.loads where id = load_id and company_id = actor.company_id for update;
  accepted_before := result.current_assignment_id is not null;
  if result.id is null or result.status in ('completed', 'cancelled') then raise exception 'Load cannot be edited'; end if;
  update public.loads set
    broker_rate = update_load_terms.broker_rate,
    loaded_miles = update_load_terms.loaded_miles,
    version = version + 1
  where id = result.id returning * into result;
  update public.load_stops set
    appointment_from = case when type = 'pickup' then pickup_appointment_from else delivery_appointment_from end,
    appointment_to = case when type = 'pickup' then pickup_appointment_to else delivery_appointment_to end,
    version = version + 1
  where load_stops.load_id = result.id;
  insert into public.load_price_snapshots(
    company_id, load_id, broker_rate, loaded_miles, loaded_rpm,
    source_attachment_id, requires_driver_reconfirmation, created_by
  ) values (
    actor.company_id, result.id, broker_rate, loaded_miles,
    case when loaded_miles > 0 then broker_rate / loaded_miles else 0 end,
    source_attachment_id, accepted_before, actor.id
  );
  if accepted_before then
    insert into public.notifications(company_id, recipient_id, type, title, body, entity_type, entity_id)
    select actor.company_id, a.driver_id, 'terms_changed', 'Load terms changed',
      'The rate, mileage, or appointment changed. Review the updated load.', 'load', result.id
    from public.assignments a where a.id = result.current_assignment_id;
  end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.terms_updated', 'load', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.begin_document_upload(
  load_id uuid,
  stop_id uuid,
  document_type text,
  file_name text,
  mime_type text,
  size_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  target_document public.documents;
  new_version_id uuid := gen_random_uuid();
  next_version integer;
  storage_path text;
begin
  select * into target_load from public.loads where id = load_id and company_id = actor.company_id;
  if target_load.id is null then raise exception 'Load not found'; end if;
  if actor.role = 'driver' and not exists (
    select 1 from public.assignments where id = target_load.current_assignment_id and driver_id = actor.id and status = 'active'
  ) then raise exception 'This load is not assigned to you'; end if;
  if actor.role not in ('driver', 'dispatcher', 'company_admin') then raise exception 'Permission denied'; end if;
  if stop_id is not null and not exists (
    select 1 from public.load_stops where id = stop_id and load_stops.load_id = target_load.id
  ) then raise exception 'Stop does not belong to load'; end if;

  select * into target_document from public.documents d
  where d.load_id = target_load.id and d.stop_id is not distinct from begin_document_upload.stop_id
    and d.document_type = begin_document_upload.document_type
  order by d.created_at limit 1;
  if target_document.id is null then
    insert into public.documents(company_id, load_id, stop_id, document_type, created_by)
    values (actor.company_id, target_load.id, stop_id, document_type, actor.id)
    returning * into target_document;
  end if;
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.document_versions where document_id = target_document.id;
  storage_path := concat(actor.company_id, '/', target_load.id, '/', target_document.id, '/', new_version_id, '/', regexp_replace(file_name, '[^a-zA-Z0-9._-]', '_', 'g'));
  insert into public.document_versions(
    id, company_id, document_id, version_number, file_name, mime_type,
    storage_path, size_bytes, is_original, uploaded_by
  ) values (
    new_version_id, actor.company_id, target_document.id, next_version, file_name,
    mime_type, storage_path, size_bytes, next_version = 1, actor.id
  );
  return jsonb_build_object(
    'documentId', target_document.id,
    'versionId', new_version_id,
    'versionNumber', next_version,
    'storagePath', storage_path,
    'bucket', 'load-documents'
  );
end;
$$;

create or replace function public.complete_document_upload(version_id uuid, checksum_sha256 text default null)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_version public.document_versions;
  result public.documents;
begin
  select * into target_version from public.document_versions
  where id = version_id and company_id = actor.company_id for update;
  if target_version.id is null or target_version.uploaded_by <> actor.id then raise exception 'Upload not found'; end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'load-documents' and o.name = target_version.storage_path
  ) then raise exception 'File upload is incomplete'; end if;
  update public.document_versions set checksum_sha256 = complete_document_upload.checksum_sha256
  where id = target_version.id;
  update public.document_versions set superseded_at = now()
  where document_id = target_version.document_id and id <> target_version.id and superseded_at is null;
  update public.documents set current_version_id = target_version.id
  where id = target_version.document_id returning * into result;
  insert into public.document_checks(company_id, document_version_id)
  values (actor.company_id, target_version.id);
  insert into public.jobs(company_id, type, payload, idempotency_key)
  values (
    actor.company_id, 'document.ai_check',
    jsonb_build_object('documentVersionId', target_version.id, 'loadId', result.load_id),
    concat('document-check:', target_version.id)
  ) on conflict (idempotency_key) do nothing;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'document.uploaded', 'document', result.id, jsonb_build_object('versionId', target_version.id));
  return result;
end;
$$;

create or replace function public.override_document_warning(check_id uuid, reason text)
returns public.document_checks
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.document_checks;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  update public.document_checks set
    status = 'overridden', overridden_by = actor.id, override_reason = trim(reason), checked_at = coalesce(checked_at, now())
  where id = check_id and company_id = actor.company_id and status in ('warning', 'failed_to_read')
  returning * into result;
  if result.id is null then raise exception 'Document warning not found'; end if;
  update public.warnings set
    is_active = false, overridden_by = actor.id, overridden_at = now(), override_reason = trim(reason)
  where document_check_id = result.id and is_active;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'document.warning_overridden', 'document_check', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.mark_notification_read(notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications set read_at = coalesce(read_at, now())
  where id = notification_id and recipient_id = (select auth.uid());
end;
$$;

revoke all on function public.set_dispatcher_driver_access(uuid, uuid[]) from public, anon;
revoke all on function public.update_driver_profile(text, text, integer, jsonb, integer) from public, anon;
revoke all on function public.withdraw_offer(uuid) from public, anon;
revoke all on function public.cancel_load(uuid, text, text) from public, anon;
revoke all on function public.reassign_load(uuid, uuid, numeric, numeric, numeric) from public, anon;
revoke all on function public.update_load_terms(uuid, numeric, numeric, timestamptz, timestamptz, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.begin_document_upload(uuid, uuid, text, text, text, bigint) from public, anon;
revoke all on function public.complete_document_upload(uuid, text) from public, anon;
revoke all on function public.override_document_warning(uuid, text) from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;

grant execute on function public.set_dispatcher_driver_access(uuid, uuid[]) to authenticated;
grant execute on function public.update_driver_profile(text, text, integer, jsonb, integer) to authenticated;
grant execute on function public.withdraw_offer(uuid) to authenticated;
grant execute on function public.cancel_load(uuid, text, text) to authenticated;
grant execute on function public.reassign_load(uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_load_terms(uuid, numeric, numeric, timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.begin_document_upload(uuid, uuid, text, text, text, bigint) to authenticated;
grant execute on function public.complete_document_upload(uuid, text) to authenticated;
grant execute on function public.override_document_warning(uuid, text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
