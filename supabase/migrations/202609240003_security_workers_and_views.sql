-- Least-privilege reads, service-role worker commands, and stable query views.

alter table public.assignments
  add column accepted_price_snapshot_id uuid references public.load_price_snapshots(id),
  add column requires_reconfirmation boolean not null default false,
  add column reconfirmed_at timestamptz;

create or replace function public.can_access_load(target_load_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_role() = 'super_admin' then true
    when public.current_app_role() in ('company_admin', 'dispatcher') then
      exists (
        select 1 from public.loads l
        where l.id = target_load_id and l.company_id = public.current_company_id()
      )
    when public.current_app_role() = 'driver' then
      exists (
        select 1 from public.loads l
        left join public.assignments a on a.id = l.current_assignment_id
        where l.id = target_load_id
          and l.company_id = public.current_company_id()
          and (
            (a.driver_id = (select auth.uid()) and a.status = 'active')
            or exists (
              select 1 from public.offers o
              where o.load_id = l.id and o.driver_id = (select auth.uid())
            )
          )
      )
    else false
  end;
$$;

create or replace function public.can_upload_load_document(target_load_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_role() in ('super_admin', 'company_admin', 'dispatcher') then
      public.can_access_load(target_load_id)
    when public.current_app_role() = 'driver' then exists (
      select 1
      from public.loads l
      join public.assignments a on a.id = l.current_assignment_id
      where l.id = target_load_id and a.driver_id = (select auth.uid()) and a.status = 'active'
    )
    else false
  end;
$$;

-- Replace broad company policies with role-aware visibility.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher'))
);

drop policy if exists gmail_connections_company_read on public.gmail_connections;
create policy gmail_connections_privileged_read on public.gmail_connections for select to authenticated
using (public.current_app_role() = 'super_admin' or (company_id = public.current_company_id() and public.is_privileged_member()));

drop policy if exists broker_messages_company_read on public.broker_messages;
create policy broker_messages_privileged_read on public.broker_messages for select to authenticated
using (public.current_app_role() = 'super_admin' or (company_id = public.current_company_id() and public.is_privileged_member()));

drop policy if exists broker_attachments_company_read on public.broker_attachments;
create policy broker_attachments_privileged_read on public.broker_attachments for select to authenticated
using (public.current_app_role() = 'super_admin' or (company_id = public.current_company_id() and public.is_privileged_member()));

drop policy if exists ai_extractions_company_read on public.ai_extractions;
create policy ai_extractions_privileged_read on public.ai_extractions for select to authenticated
using (public.current_app_role() = 'super_admin' or (company_id = public.current_company_id() and public.is_privileged_member()));

drop policy if exists ai_extraction_fields_company_read on public.ai_extraction_fields;
create policy ai_fields_privileged_read on public.ai_extraction_fields for select to authenticated
using (public.current_app_role() = 'super_admin' or (company_id = public.current_company_id() and public.is_privileged_member()));

drop policy if exists loads_company_read on public.loads;
create policy loads_scoped_read on public.loads for select to authenticated
using (public.can_access_load(id));

drop policy if exists load_stops_company_read on public.load_stops;
create policy load_stops_scoped_read on public.load_stops for select to authenticated
using (public.can_access_load(load_id));

drop policy if exists load_price_snapshots_company_read on public.load_price_snapshots;
create policy load_prices_scoped_read on public.load_price_snapshots for select to authenticated
using (public.can_access_load(load_id));

drop policy if exists offers_company_read on public.offers;
create policy offers_scoped_read on public.offers for select to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher'))
  or driver_id = (select auth.uid())
);

drop policy if exists assignments_company_read on public.assignments;
create policy assignments_scoped_read on public.assignments for select to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher'))
  or driver_id = (select auth.uid())
);

drop policy if exists documents_company_read on public.documents;
create policy documents_scoped_read on public.documents for select to authenticated
using (public.can_access_load(load_id));

drop policy if exists document_versions_company_read on public.document_versions;
create policy document_versions_scoped_read on public.document_versions for select to authenticated
using (exists (
  select 1 from public.documents d
  where d.id = document_versions.document_id and public.can_access_load(d.load_id)
));

drop policy if exists document_checks_company_read on public.document_checks;
create policy document_checks_scoped_read on public.document_checks for select to authenticated
using (exists (
  select 1
  from public.document_versions v
  join public.documents d on d.id = v.document_id
  where v.id = document_checks.document_version_id and public.can_access_load(d.load_id)
));

drop policy if exists warnings_company_read on public.warnings;
create policy warnings_scoped_read on public.warnings for select to authenticated
using (public.can_access_load(load_id));

drop policy if exists driver_presence_company_read on public.driver_presence;
create policy driver_presence_scoped_read on public.driver_presence for select to authenticated
using (
  driver_id = (select auth.uid())
  or public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher') and public.can_access_driver(driver_id))
);

drop policy if exists location_snapshots_company_read on public.location_snapshots;
create policy location_snapshots_scoped_read on public.location_snapshots for select to authenticated
using (
  driver_id = (select auth.uid())
  or public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher') and public.can_access_driver(driver_id))
);

drop policy if exists client_operations_company_read on public.client_operations;
create policy client_operations_scoped_read on public.client_operations for select to authenticated
using (
  actor_id = (select auth.uid())
  or public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher'))
);

drop policy if exists notifications_company_read on public.notifications;
create policy notifications_recipient_read on public.notifications for select to authenticated
using (recipient_id = (select auth.uid()));

drop policy if exists audit_events_company_read on public.audit_events;
create policy audit_events_privileged_read on public.audit_events for select to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher'))
);

drop policy if exists storage_company_read on storage.objects;
drop policy if exists storage_company_upload on storage.objects;

create policy storage_broker_originals_read on storage.objects for select to authenticated
using (
  bucket_id = 'broker-originals'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.is_privileged_member()
);

create policy storage_load_documents_read on storage.objects for select to authenticated
using (
  bucket_id = 'load-documents'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.can_access_load(((storage.foldername(name))[2])::uuid)
);

create policy storage_load_documents_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'load-documents'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.can_upload_load_document(((storage.foldername(name))[2])::uuid)
);

create or replace view public.member_directory
with (security_invoker = true)
as
select
  p.id,
  p.company_id,
  p.role,
  p.status,
  p.full_name,
  case when public.is_privileged_member() then p.email else null end as email,
  case when public.is_privileged_member() then p.phone else null end as phone,
  d.vehicle_type,
  d.trailer_type,
  d.capacity_lbs,
  d.equipment
from public.profiles p
left join public.driver_profiles d on d.user_id = p.id
where p.company_id = public.current_company_id()
  and (
    public.is_privileged_member()
    or p.id = (select auth.uid())
  );

create or replace view public.load_overview
with (security_invoker = true)
as
select
  l.id,
  l.company_id,
  l.load_number,
  l.status,
  l.broker_name,
  l.cargo_description,
  l.equipment_type,
  l.weight_lbs,
  l.broker_rate,
  l.loaded_miles,
  l.loaded_rpm,
  l.owner_dispatcher_id,
  l.current_assignment_id,
  l.version,
  l.updated_at,
  pickup.facility_name as pickup_facility,
  pickup.city as pickup_city,
  pickup.region as pickup_region,
  pickup.appointment_from as pickup_from,
  pickup.appointment_to as pickup_to,
  pickup.status as pickup_status,
  delivery.facility_name as delivery_facility,
  delivery.city as delivery_city,
  delivery.region as delivery_region,
  delivery.appointment_from as delivery_from,
  delivery.appointment_to as delivery_to,
  delivery.status as delivery_status,
  a.driver_id
from public.loads l
left join public.load_stops pickup on pickup.load_id = l.id and pickup.type = 'pickup'
left join public.load_stops delivery on delivery.load_id = l.id and delivery.type = 'delivery'
left join public.assignments a on a.id = l.current_assignment_id;

create or replace view public.driver_offer_inbox
with (security_invoker = true)
as
select
  o.id,
  o.load_id,
  o.driver_id,
  o.status,
  o.estimated_deadhead_miles,
  o.loaded_miles,
  o.effective_rpm,
  o.compatibility_warnings,
  o.delivered_at,
  o.seen_at,
  o.created_at,
  l.load_number,
  l.broker_rate,
  l.cargo_description,
  l.equipment_type,
  l.weight_lbs
from public.offers o
join public.loads l on l.id = o.load_id
where o.driver_id = (select auth.uid());

grant select on public.member_directory, public.load_overview, public.driver_offer_inbox to authenticated;

create or replace function public.register_company_member(
  user_id uuid,
  company_id uuid,
  role public.app_role,
  full_name text,
  email text,
  phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare result public.profiles;
begin
  if role not in ('company_admin', 'dispatcher', 'driver') then raise exception 'Company role is invalid'; end if;
  if not exists (select 1 from auth.users u where u.id = user_id) then raise exception 'Auth user not found'; end if;
  insert into public.profiles(id, company_id, role, status, full_name, email, phone)
  values (user_id, company_id, role, 'active', trim(full_name), lower(trim(email)), phone)
  on conflict (id) do update set
    company_id = excluded.company_id,
    role = excluded.role,
    status = 'active',
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone
  returning * into result;
  if role = 'driver' then
    insert into public.driver_profiles(user_id, company_id) values (user_id, company_id)
    on conflict (user_id) do nothing;
  end if;
  insert into public.audit_events(company_id, action, entity_type, entity_id, new_value, metadata)
  values (company_id, 'member.registered', 'profile', user_id, to_jsonb(result), jsonb_build_object('source', 'service_role'));
  return result;
end;
$$;

create or replace function public.set_member_status(member_id uuid, next_status public.account_status)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.profiles;
begin
  if actor.id is null or actor.role not in ('company_admin', 'super_admin') then
    raise exception 'Company admin permission required';
  end if;
  update public.profiles set status = next_status
  where id = member_id and (actor.role = 'super_admin' or company_id = actor.company_id)
  returning * into result;
  if result.id is null then raise exception 'Member not found'; end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (result.company_id, actor.id, 'member.status_changed', 'profile', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.register_gmail_connection(
  company_id uuid,
  mailbox_email text,
  secret_reference text,
  history_id text default null,
  watch_expires_at timestamptz default null,
  created_by uuid default null
)
returns public.gmail_connections
language plpgsql
security definer
set search_path = public
as $$
declare result public.gmail_connections;
begin
  insert into public.gmail_connections(
    company_id, mailbox_email, status, secret_reference, provider_history_id,
    watch_expires_at, created_by, last_synced_at
  ) values (
    company_id, lower(trim(mailbox_email)), 'active', secret_reference, history_id,
    watch_expires_at, created_by, now()
  ) on conflict (company_id) do update set
    mailbox_email = excluded.mailbox_email,
    status = 'active',
    secret_reference = excluded.secret_reference,
    provider_history_id = excluded.provider_history_id,
    watch_expires_at = excluded.watch_expires_at,
    last_error = null,
    last_synced_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.ingest_broker_message(
  company_id uuid,
  gmail_connection_id uuid,
  provider_message_id text,
  provider_thread_id text,
  from_email text,
  subject text,
  received_at timestamptz,
  raw_storage_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare message_id uuid;
begin
  insert into public.broker_messages(
    company_id, gmail_connection_id, provider_message_id, provider_thread_id,
    from_email, subject, received_at, raw_storage_path
  ) values (
    company_id, gmail_connection_id, provider_message_id, provider_thread_id,
    lower(trim(from_email)), subject, received_at, raw_storage_path
  ) on conflict (company_id, provider_message_id) do update set
    provider_thread_id = excluded.provider_thread_id
  returning id into message_id;
  insert into public.jobs(company_id, type, payload, idempotency_key)
  values (
    company_id, 'broker_message.extract', jsonb_build_object('messageId', message_id),
    concat('broker-message:', company_id, ':', provider_message_id)
  ) on conflict (idempotency_key) do nothing;
  return message_id;
end;
$$;

create or replace function public.claim_jobs(worker_id text, job_types text[], batch_size integer default 10)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with selected as (
    select id from public.jobs
    where status in ('pending', 'failed')
      and available_at <= now()
      and type = any(job_types)
      and attempt_count < max_attempts
    order by available_at, created_at
    limit least(greatest(batch_size, 1), 100)
    for update skip locked
  )
  update public.jobs j
  set status = 'processing', locked_at = now(), locked_by = worker_id,
      attempt_count = attempt_count + 1
  from selected s
  where j.id = s.id
  returning j.*;
end;
$$;

create or replace function public.complete_job(job_id uuid, worker_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs set status = 'completed', locked_at = null, locked_by = null, last_error = null
  where id = job_id and status = 'processing' and locked_by = worker_id;
  if not found then raise exception 'Job is not owned by worker'; end if;
end;
$$;

create or replace function public.fail_job(
  job_id uuid,
  worker_id text,
  error_message text,
  retry_after interval default interval '1 minute'
)
returns public.job_status
language plpgsql
security definer
set search_path = public
as $$
declare next_status public.job_status;
begin
  update public.jobs set
    status = case when attempt_count >= max_attempts then 'dead_letter'::public.job_status else 'failed'::public.job_status end,
    available_at = now() + greatest(retry_after, interval '5 seconds'),
    locked_at = null,
    locked_by = null,
    last_error = left(error_message, 4000)
  where id = job_id and status = 'processing' and locked_by = worker_id
  returning status into next_status;
  if next_status is null then raise exception 'Job is not owned by worker'; end if;
  return next_status;
end;
$$;

create or replace function public.record_document_check(
  check_id uuid,
  next_status public.document_check_status,
  confidence numeric,
  model_name text,
  result jsonb,
  warnings jsonb default '[]'::jsonb
)
returns public.document_checks
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.document_checks;
  target_load_id uuid;
  warning jsonb;
begin
  update public.document_checks set
    status = next_status,
    confidence = record_document_check.confidence,
    model_name = record_document_check.model_name,
    result = record_document_check.result,
    checked_at = now()
  where id = check_id and status in ('queued', 'checking', 'warning', 'failed_to_read')
  returning * into saved;
  if saved.id is null then raise exception 'Document check not found'; end if;
  select d.load_id into target_load_id
  from public.document_versions v join public.documents d on d.id = v.document_id
  where v.id = saved.document_version_id;
  update public.warnings set is_active = false
  where document_check_id = saved.id and is_active;
  for warning in select * from jsonb_array_elements(coalesce(warnings, '[]'::jsonb)) loop
    insert into public.warnings(company_id, load_id, document_check_id, code, message)
    values (saved.company_id, target_load_id, saved.id, warning->>'code', warning->>'message');
  end loop;
  insert into public.audit_events(company_id, action, entity_type, entity_id, new_value, metadata)
  values (saved.company_id, 'document.ai_checked', 'document_check', saved.id, to_jsonb(saved), jsonb_build_object('source', 'worker'));
  return saved;
end;
$$;

-- Driver reconfirms material terms after an accepted load changes.
create or replace function public.confirm_updated_terms(load_id uuid)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.assignments;
  latest_snapshot_id uuid;
begin
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;
  select id into latest_snapshot_id from public.load_price_snapshots
  where load_price_snapshots.load_id = confirm_updated_terms.load_id
  order by created_at desc limit 1;
  update public.assignments a set
    requires_reconfirmation = false,
    reconfirmed_at = now(),
    accepted_price_snapshot_id = latest_snapshot_id
  from public.loads l
  where l.id = confirm_updated_terms.load_id
    and a.id = l.current_assignment_id
    and a.driver_id = actor.id
    and a.status = 'active'
  returning a.* into result;
  if result.id is null then raise exception 'Active assignment not found'; end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.terms_reconfirmed', 'assignment', result.id, to_jsonb(result));
  return result;
end;
$$;

-- Material terms changes mark the active assignment for reconfirmation.
create or replace function public.mark_assignment_reconfirmation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.requires_driver_reconfirmation then
    update public.assignments a set requires_reconfirmation = true, reconfirmed_at = null
    from public.loads l
    where l.id = new.load_id and a.id = l.current_assignment_id and a.status = 'active';
  end if;
  return new;
end;
$$;

create trigger price_snapshot_reconfirmation
after insert on public.load_price_snapshots
for each row execute function public.mark_assignment_reconfirmation();

-- Client functions.
revoke all on function public.can_access_load(uuid) from public, anon;
revoke all on function public.can_upload_load_document(uuid) from public, anon;
revoke all on function public.set_member_status(uuid, public.account_status) from public, anon;
revoke all on function public.confirm_updated_terms(uuid) from public, anon;
grant execute on function public.can_access_load(uuid) to authenticated;
grant execute on function public.can_upload_load_document(uuid) to authenticated;
grant execute on function public.set_member_status(uuid, public.account_status) to authenticated;
grant execute on function public.confirm_updated_terms(uuid) to authenticated;

-- Worker/service-role functions are never callable by anon/authenticated.
revoke all on function public.register_company_member(uuid, uuid, public.app_role, text, text, text) from public, anon, authenticated;
revoke all on function public.register_gmail_connection(uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ingest_broker_message(uuid, uuid, text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.claim_jobs(text, text[], integer) from public, anon, authenticated;
revoke all on function public.complete_job(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, text, text, interval) from public, anon, authenticated;
revoke all on function public.record_document_check(uuid, public.document_check_status, numeric, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.register_company_member(uuid, uuid, public.app_role, text, text, text) to service_role;
grant execute on function public.register_gmail_connection(uuid, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.ingest_broker_message(uuid, uuid, text, text, text, text, timestamptz, text) to service_role;
grant execute on function public.claim_jobs(text, text[], integer) to service_role;
grant execute on function public.complete_job(uuid, text) to service_role;
grant execute on function public.fail_job(uuid, text, text, interval) to service_role;
grant execute on function public.record_document_check(uuid, public.document_check_status, numeric, text, jsonb, jsonb) to service_role;
