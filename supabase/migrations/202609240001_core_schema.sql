-- ApexHaul operational core.
-- Clients may read authorized rows, but all business mutations go through RPCs.

create extension if not exists pgcrypto;

create type public.app_role as enum ('super_admin', 'company_admin', 'dispatcher', 'driver');
create type public.account_status as enum ('active', 'invited', 'suspended');
create type public.gmail_connection_status as enum ('active', 'needs_reconnect', 'disabled');
create type public.ingestion_status as enum ('queued', 'processing', 'extracted', 'needs_review', 'parse_failed');
create type public.load_status as enum ('draft', 'review', 'ready_for_offer', 'offered', 'assigned', 'in_progress', 'delivered', 'completed', 'cancelled', 'dispute');
create type public.stop_type as enum ('pickup', 'delivery');
create type public.stop_status as enum ('pending', 'arrived', 'done', 'skipped');
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'withdrawn', 'superseded', 'missed_offline');
create type public.assignment_status as enum ('active', 'reassigned', 'cancelled', 'completed');
create type public.document_check_status as enum ('queued', 'checking', 'passed', 'warning', 'overridden', 'failed_to_read');
create type public.job_status as enum ('pending', 'processing', 'completed', 'failed', 'dead_letter');
create type public.operation_status as enum ('pending', 'accepted', 'rejected');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete restrict,
  role public.app_role not null,
  status public.account_status not null default 'active',
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_company_required check (role = 'super_admin' or company_id is not null)
);

create unique index profiles_email_unique on public.profiles (lower(email));
create index profiles_company_role_idx on public.profiles (company_id, role, status);

create table public.driver_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_type text,
  trailer_type text,
  capacity_lbs integer check (capacity_lbs is null or capacity_lbs > 0),
  equipment jsonb not null default '[]'::jsonb,
  hos_available_minutes integer check (hos_available_minutes is null or hos_available_minutes >= 0),
  updated_at timestamptz not null default now()
);

create table public.dispatcher_driver_access (
  dispatcher_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (dispatcher_id, driver_id),
  constraint dispatcher_not_driver check (dispatcher_id <> driver_id)
);

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  mailbox_email text not null,
  status public.gmail_connection_status not null default 'active',
  secret_reference text not null,
  provider_history_id text,
  watch_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.broker_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  gmail_connection_id uuid references public.gmail_connections(id) on delete set null,
  provider_message_id text not null,
  provider_thread_id text,
  from_email text not null,
  subject text,
  received_at timestamptz not null,
  raw_storage_path text,
  status public.ingestion_status not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  unique (company_id, provider_message_id)
);

create index broker_messages_company_received_idx on public.broker_messages (company_id, received_at desc);

create table public.broker_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id uuid not null references public.broker_messages(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  checksum_sha256 text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now(),
  unique (message_id, checksum_sha256)
);

create table public.ai_extractions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id uuid not null references public.broker_messages(id) on delete cascade,
  attachment_id uuid references public.broker_attachments(id) on delete set null,
  status public.ingestion_status not null default 'queued',
  model_name text,
  schema_version integer not null default 1,
  result jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ai_extraction_fields (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.ai_extractions(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  field_name text not null,
  extracted_value jsonb,
  dispatcher_value jsonb,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  source_reference text,
  corrected_by uuid references public.profiles(id),
  corrected_at timestamptz,
  unique (extraction_id, field_name)
);

create table public.loads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_dispatcher_id uuid not null references public.profiles(id),
  broker_message_id uuid references public.broker_messages(id) on delete set null,
  load_number text not null,
  status public.load_status not null default 'draft',
  broker_name text,
  cargo_description text,
  equipment_type text,
  weight_lbs integer check (weight_lbs is null or weight_lbs > 0),
  broker_rate numeric(12,2) not null check (broker_rate >= 0),
  loaded_miles numeric(10,2) not null check (loaded_miles >= 0),
  loaded_rpm numeric(12,4) generated always as (
    case when loaded_miles > 0 then broker_rate / loaded_miles else 0 end
  ) stored,
  current_assignment_id uuid,
  cancellation_source text,
  cancellation_reason text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, load_number)
);

create index loads_company_status_idx on public.loads (company_id, status, created_at desc);
create index loads_owner_idx on public.loads (owner_dispatcher_id, status);

create table public.load_stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  type public.stop_type not null,
  sequence integer not null check (sequence > 0),
  facility_name text,
  address_line text not null,
  city text not null,
  region text not null,
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  appointment_from timestamptz,
  appointment_to timestamptz,
  status public.stop_status not null default 'pending',
  requires_document boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (load_id, sequence),
  constraint appointment_window_valid check (
    appointment_from is null or appointment_to is null or appointment_to >= appointment_from
  )
);

create index load_stops_load_sequence_idx on public.load_stops (load_id, sequence);

create table public.load_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  broker_rate numeric(12,2) not null check (broker_rate >= 0),
  loaded_miles numeric(10,2) not null check (loaded_miles >= 0),
  loaded_rpm numeric(12,4) not null check (loaded_rpm >= 0),
  source_attachment_id uuid references public.broker_attachments(id),
  requires_driver_reconfirmation boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  status public.offer_status not null default 'pending',
  origin_latitude numeric(9,6),
  origin_longitude numeric(9,6),
  estimated_deadhead_miles numeric(10,2) not null default 0 check (estimated_deadhead_miles >= 0),
  loaded_miles numeric(10,2) not null check (loaded_miles >= 0),
  effective_rpm numeric(12,4) not null default 0 check (effective_rpm >= 0),
  compatibility_warnings jsonb not null default '[]'::jsonb,
  delivered_at timestamptz,
  seen_at timestamptz,
  responded_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index offers_one_pending_per_driver_load_idx
  on public.offers (load_id, driver_id) where status = 'pending';
create index offers_driver_status_idx on public.offers (driver_id, status, created_at desc);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  offer_id uuid references public.offers(id),
  status public.assignment_status not null default 'active',
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index assignments_one_active_per_load_idx
  on public.assignments (load_id) where status = 'active';
create index assignments_driver_status_idx on public.assignments (driver_id, status, assigned_at desc);

alter table public.loads
  add constraint loads_current_assignment_fk
  foreign key (current_assignment_id) references public.assignments(id) deferrable initially deferred;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  stop_id uuid references public.load_stops(id) on delete set null,
  document_type text not null,
  current_version_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  checksum_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  is_original boolean not null default false,
  superseded_at timestamptz,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (storage_path)
);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) deferrable initially deferred;

create table public.document_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  status public.document_check_status not null default 'queued',
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  model_name text,
  result jsonb,
  checked_at timestamptz,
  overridden_by uuid references public.profiles(id),
  override_reason text,
  created_at timestamptz not null default now()
);

create table public.warnings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  document_check_id uuid references public.document_checks(id) on delete cascade,
  code text not null,
  message text not null,
  is_active boolean not null default true,
  overridden_by uuid references public.profiles(id),
  overridden_at timestamptz,
  override_reason text,
  created_at timestamptz not null default now()
);

create table public.driver_presence (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  is_online boolean not null default false,
  latitude numeric(9,6),
  longitude numeric(9,6),
  heading numeric(6,2),
  speed_mph numeric(7,2),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.location_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  load_id uuid references public.loads(id) on delete cascade,
  event_type text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.client_operations (
  operation_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  load_id uuid references public.loads(id) on delete cascade,
  command_type text not null,
  base_version bigint,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  status public.operation_status not null,
  result jsonb,
  error_message text
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  type text not null,
  status public.job_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_claim_idx on public.jobs (status, available_at, created_at)
  where status in ('pending', 'failed');

create table public.audit_events (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_events_company_time_idx on public.audit_events (company_id, occurred_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at before update on public.companies
for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger gmail_connections_set_updated_at before update on public.gmail_connections
for each row execute function public.set_updated_at();
create trigger loads_set_updated_at before update on public.loads
for each row execute function public.set_updated_at();
create trigger load_stops_set_updated_at before update on public.load_stops
for each row execute function public.set_updated_at();
create trigger offers_set_updated_at before update on public.offers
for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at before update on public.jobs
for each row execute function public.set_updated_at();

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function public.prevent_audit_mutation();

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = (select auth.uid()) and status = 'active';
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = (select auth.uid()) and status = 'active';
$$;

create or replace function public.is_privileged_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('super_admin', 'company_admin', 'dispatcher'), false);
$$;

create or replace function public.can_access_driver(target_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_role() in ('super_admin', 'company_admin') then true
    when public.current_app_role() = 'dispatcher' then
      exists (
        select 1 from public.dispatcher_driver_access a
        where a.dispatcher_id = (select auth.uid()) and a.driver_id = target_driver_id
      ) or not exists (
        select 1 from public.dispatcher_driver_access a
        where a.dispatcher_id = (select auth.uid())
      )
    else target_driver_id = (select auth.uid())
  end;
$$;

create or replace function public.bootstrap_company(company_name text, full_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor uuid := (select auth.uid());
  actor_email text;
  new_company_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.profiles where id = actor) then
    raise exception 'Profile already exists';
  end if;
  select email into actor_email from auth.users where id = actor;
  insert into public.companies(name) values (trim(company_name)) returning id into new_company_id;
  insert into public.profiles(id, company_id, role, full_name, email)
  values (actor, new_company_id, 'company_admin', trim(full_name), actor_email);
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (new_company_id, actor, 'company.bootstrap', 'company', new_company_id, jsonb_build_object('name', trim(company_name)));
  return new_company_id;
end;
$$;

create or replace function public.create_load_draft(
  load_number text,
  broker_name text,
  cargo_description text,
  equipment_type text,
  weight_lbs integer,
  broker_rate numeric,
  loaded_miles numeric,
  pickup jsonb,
  delivery jsonb,
  broker_message_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  new_load_id uuid;
begin
  actor := public.current_profile();
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  insert into public.loads(
    company_id, owner_dispatcher_id, broker_message_id, load_number, status,
    broker_name, cargo_description, equipment_type, weight_lbs, broker_rate, loaded_miles
  ) values (
    actor.company_id, actor.id, broker_message_id, trim(load_number), 'review',
    broker_name, cargo_description, equipment_type, weight_lbs, broker_rate, loaded_miles
  ) returning id into new_load_id;

  insert into public.load_stops(
    company_id, load_id, type, sequence, facility_name, address_line, city, region,
    postal_code, latitude, longitude, appointment_from, appointment_to, requires_document
  ) values
  (
    actor.company_id, new_load_id, 'pickup', 1, pickup->>'facilityName', pickup->>'addressLine',
    pickup->>'city', pickup->>'region', pickup->>'postalCode',
    nullif(pickup->>'latitude', '')::numeric, nullif(pickup->>'longitude', '')::numeric,
    nullif(pickup->>'appointmentFrom', '')::timestamptz, nullif(pickup->>'appointmentTo', '')::timestamptz,
    coalesce((pickup->>'requiresDocument')::boolean, true)
  ),
  (
    actor.company_id, new_load_id, 'delivery', 2, delivery->>'facilityName', delivery->>'addressLine',
    delivery->>'city', delivery->>'region', delivery->>'postalCode',
    nullif(delivery->>'latitude', '')::numeric, nullif(delivery->>'longitude', '')::numeric,
    nullif(delivery->>'appointmentFrom', '')::timestamptz, nullif(delivery->>'appointmentTo', '')::timestamptz,
    coalesce((delivery->>'requiresDocument')::boolean, true)
  );

  insert into public.load_price_snapshots(
    company_id, load_id, broker_rate, loaded_miles, loaded_rpm, created_by
  ) values (
    actor.company_id, new_load_id, broker_rate, loaded_miles,
    case when loaded_miles > 0 then broker_rate / loaded_miles else 0 end,
    actor.id
  );

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.created', 'load', new_load_id, jsonb_build_object('loadNumber', trim(load_number)));
  return new_load_id;
end;
$$;

create or replace function public.approve_load_draft(load_id uuid)
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
  update public.loads
  set status = 'ready_for_offer', version = version + 1
  where id = load_id and company_id = actor.company_id and status in ('draft', 'review')
  returning * into result;
  if result.id is null then raise exception 'Load is not reviewable'; end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.approved', 'load', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.send_offer(
  load_id uuid,
  driver_id uuid,
  origin_latitude numeric default null,
  origin_longitude numeric default null,
  estimated_deadhead_miles numeric default 0,
  compatibility_warnings jsonb default '[]'::jsonb
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
  if target_load.id is null or target_load.status not in ('ready_for_offer', 'offered') then
    raise exception 'Load is not available for offers';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = driver_id and company_id = actor.company_id and role = 'driver' and status = 'active'
  ) then raise exception 'Driver is not eligible'; end if;

  insert into public.offers(
    company_id, load_id, driver_id, origin_latitude, origin_longitude,
    estimated_deadhead_miles, loaded_miles, effective_rpm,
    compatibility_warnings, delivered_at, created_by
  ) values (
    actor.company_id, target_load.id, driver_id, origin_latitude, origin_longitude,
    greatest(estimated_deadhead_miles, 0), target_load.loaded_miles,
    case when target_load.loaded_miles + greatest(estimated_deadhead_miles, 0) > 0
      then target_load.broker_rate / (target_load.loaded_miles + greatest(estimated_deadhead_miles, 0)) else 0 end,
    compatibility_warnings, now(), actor.id
  ) returning * into result;

  update public.loads set status = 'offered', version = version + 1 where id = target_load.id;
  insert into public.notifications(company_id, recipient_id, type, title, body, entity_type, entity_id)
  values (actor.company_id, driver_id, 'load_offer', 'New load offer', 'A dispatcher sent you a load offer.', 'offer', result.id);
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'offer.sent', 'offer', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.respond_offer(
  offer_id uuid,
  response text,
  operation_id uuid,
  occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_offer public.offers;
  target_load public.loads;
  new_assignment public.assignments;
  response_payload jsonb;
begin
  select result into response_payload from public.client_operations
  where client_operations.operation_id = respond_offer.operation_id and actor_id = (select auth.uid());
  if response_payload is not null then return response_payload; end if;
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;

  select * into target_offer from public.offers
  where id = offer_id and driver_id = actor.id and company_id = actor.company_id for update;
  if target_offer.id is null or target_offer.status <> 'pending' then
    raise exception 'Offer is no longer available';
  end if;
  select * into target_load from public.loads where id = target_offer.load_id for update;

  if lower(response) = 'decline' then
    update public.offers set status = 'declined', responded_at = now() where id = target_offer.id;
    response_payload := jsonb_build_object('offerId', target_offer.id, 'status', 'declined');
    insert into public.client_operations values (
      operation_id, actor.company_id, actor.id, target_load.id, 'respond_offer', target_load.version,
      jsonb_build_object('response', 'decline'), occurred_at, now(), 'accepted', response_payload, null
    );
    insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
    values (actor.company_id, actor.id, 'offer.declined', 'offer', target_offer.id, response_payload);
    return response_payload;
  end if;

  if lower(response) <> 'accept' then raise exception 'Response must be accept or decline'; end if;
  if target_load.status not in ('offered', 'ready_for_offer') or target_load.current_assignment_id is not null then
    update public.offers set status = 'superseded', responded_at = now() where id = target_offer.id;
    raise exception 'Load was assigned to another driver';
  end if;

  insert into public.assignments(company_id, load_id, driver_id, offer_id, assigned_by, accepted_at)
  values (actor.company_id, target_load.id, actor.id, target_offer.id, target_offer.created_by, now())
  returning * into new_assignment;

  update public.offers set status = 'accepted', responded_at = now() where id = target_offer.id;
  update public.offers set status = 'superseded', responded_at = now()
    where load_id = target_load.id and id <> target_offer.id and status = 'pending';
  update public.loads
    set status = 'assigned', current_assignment_id = new_assignment.id, version = version + 1
    where id = target_load.id;

  response_payload := jsonb_build_object(
    'offerId', target_offer.id, 'loadId', target_load.id,
    'assignmentId', new_assignment.id, 'status', 'accepted'
  );
  insert into public.client_operations values (
    operation_id, actor.company_id, actor.id, target_load.id, 'respond_offer', target_load.version,
    jsonb_build_object('response', 'accept'), occurred_at, now(), 'accepted', response_payload, null
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'offer.accepted', 'offer', target_offer.id, response_payload);
  return response_payload;
end;
$$;

create or replace function public.transition_stop(
  stop_id uuid,
  next_status public.stop_status,
  operation_id uuid,
  base_load_version bigint,
  occurred_at timestamptz default now(),
  latitude numeric default null,
  longitude numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_stop public.load_stops;
  target_load public.loads;
  allowed boolean := false;
  response_payload jsonb;
begin
  select result into response_payload from public.client_operations
  where client_operations.operation_id = transition_stop.operation_id and actor_id = (select auth.uid());
  if response_payload is not null then return response_payload; end if;

  select * into target_stop from public.load_stops where id = stop_id for update;
  if target_stop.id is null or target_stop.company_id <> actor.company_id then raise exception 'Stop not found'; end if;
  select * into target_load from public.loads where id = target_stop.load_id for update;
  if target_load.version <> base_load_version then raise exception 'Load changed; refresh before retrying'; end if;
  if actor.role = 'driver' and not exists (
    select 1 from public.assignments
    where id = target_load.current_assignment_id and driver_id = actor.id and status = 'active'
  ) then raise exception 'This load is no longer assigned to you'; end if;
  if actor.role not in ('driver', 'dispatcher', 'company_admin') then raise exception 'Permission denied'; end if;

  allowed := (target_stop.status = 'pending' and next_status in ('arrived', 'skipped'))
          or (target_stop.status = 'arrived' and next_status = 'done');
  if not allowed then raise exception 'Invalid stop transition'; end if;
  if next_status = 'done' and target_stop.requires_document and not exists (
    select 1 from public.documents d where d.stop_id = target_stop.id and d.current_version_id is not null
  ) then raise exception 'Required document is missing'; end if;

  update public.load_stops set status = next_status, version = version + 1 where id = target_stop.id;
  if target_stop.type = 'pickup' and next_status in ('arrived', 'done') then
    update public.loads set status = 'in_progress', version = version + 1 where id = target_load.id;
  elsif target_stop.type = 'delivery' and next_status = 'done' then
    update public.loads set status = 'delivered', version = version + 1 where id = target_load.id;
  else
    update public.loads set version = version + 1 where id = target_load.id;
  end if;

  if latitude is not null and longitude is not null then
    insert into public.location_snapshots(company_id, driver_id, load_id, event_type, latitude, longitude, captured_at)
    values (actor.company_id, actor.id, target_load.id, concat(target_stop.type::text, '.', next_status::text), latitude, longitude, occurred_at);
  end if;
  response_payload := jsonb_build_object('stopId', target_stop.id, 'status', next_status, 'loadId', target_load.id);
  insert into public.client_operations values (
    operation_id, actor.company_id, actor.id, target_load.id, 'transition_stop', base_load_version,
    jsonb_build_object('stopId', stop_id, 'nextStatus', next_status), occurred_at, now(), 'accepted', response_payload, null
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'stop.transitioned', 'stop', target_stop.id, response_payload);
  return response_payload;
end;
$$;

create or replace function public.complete_load(load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.loads;
begin
  select * into result from public.loads where id = load_id and company_id = actor.company_id for update;
  if result.id is null or result.status <> 'delivered' then raise exception 'Load is not deliverable'; end if;
  if actor.role = 'driver' and not exists (
    select 1 from public.assignments where id = result.current_assignment_id and driver_id = actor.id and status = 'active'
  ) then raise exception 'This load is no longer assigned to you'; end if;
  update public.loads set status = 'completed', version = version + 1 where id = result.id returning * into result;
  update public.assignments set status = 'completed', ended_at = now() where id = result.current_assignment_id;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.completed', 'load', result.id, to_jsonb(result));
  return result;
end;
$$;

create or replace function public.upsert_driver_presence(
  latitude numeric,
  longitude numeric,
  heading numeric default null,
  speed_mph numeric default null,
  online boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor public.profiles := public.current_profile();
begin
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;
  insert into public.driver_presence(driver_id, company_id, is_online, latitude, longitude, heading, speed_mph, last_seen_at)
  values (actor.id, actor.company_id, online, latitude, longitude, heading, speed_mph, now())
  on conflict (driver_id) do update set
    is_online = excluded.is_online,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    heading = excluded.heading,
    speed_mph = excluded.speed_mph,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();
end;
$$;

-- RLS: authenticated clients read scoped rows; business writes are RPC-only.
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.dispatcher_driver_access enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.broker_messages enable row level security;
alter table public.broker_attachments enable row level security;
alter table public.ai_extractions enable row level security;
alter table public.ai_extraction_fields enable row level security;
alter table public.loads enable row level security;
alter table public.load_stops enable row level security;
alter table public.load_price_snapshots enable row level security;
alter table public.offers enable row level security;
alter table public.assignments enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_checks enable row level security;
alter table public.warnings enable row level security;
alter table public.driver_presence enable row level security;
alter table public.location_snapshots enable row level security;
alter table public.client_operations enable row level security;
alter table public.notifications enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_events enable row level security;

create policy companies_read on public.companies for select to authenticated
using (id = public.current_company_id() or public.current_app_role() = 'super_admin');
create policy profiles_read on public.profiles for select to authenticated
using (company_id = public.current_company_id() or id = (select auth.uid()) or public.current_app_role() = 'super_admin');

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'driver_profiles', 'dispatcher_driver_access', 'gmail_connections', 'broker_messages',
    'broker_attachments', 'ai_extractions', 'ai_extraction_fields', 'loads', 'load_stops',
    'load_price_snapshots', 'offers', 'assignments', 'documents', 'document_versions',
    'document_checks', 'warnings', 'driver_presence', 'location_snapshots', 'client_operations',
    'notifications', 'audit_events'
  ] loop
    execute format(
      'create policy %I_company_read on public.%I for select to authenticated using (company_id = public.current_company_id() or public.current_app_role() = ''super_admin'')',
      table_name, table_name
    );
  end loop;
end $$;

-- Jobs are intentionally invisible to clients. Service-role workers bypass RLS.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.companies, public.profiles, public.driver_profiles,
  public.dispatcher_driver_access, public.gmail_connections, public.broker_messages,
  public.broker_attachments, public.ai_extractions, public.ai_extraction_fields,
  public.loads, public.load_stops, public.load_price_snapshots, public.offers,
  public.assignments, public.documents, public.document_versions, public.document_checks,
  public.warnings, public.driver_presence, public.location_snapshots,
  public.client_operations, public.notifications, public.audit_events to authenticated;

revoke all on function public.current_profile() from public, anon;
revoke all on function public.current_company_id() from public, anon;
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_privileged_member() from public, anon;
revoke all on function public.can_access_driver(uuid) from public, anon;
revoke all on function public.bootstrap_company(text, text) from public, anon;
revoke all on function public.create_load_draft(text, text, text, text, integer, numeric, numeric, jsonb, jsonb, uuid) from public, anon;
revoke all on function public.approve_load_draft(uuid) from public, anon;
revoke all on function public.send_offer(uuid, uuid, numeric, numeric, numeric, jsonb) from public, anon;
revoke all on function public.respond_offer(uuid, text, uuid, timestamptz) from public, anon;
revoke all on function public.transition_stop(uuid, public.stop_status, uuid, bigint, timestamptz, numeric, numeric) from public, anon;
revoke all on function public.complete_load(uuid) from public, anon;
revoke all on function public.upsert_driver_presence(numeric, numeric, numeric, numeric, boolean) from public, anon;

grant execute on function public.current_profile() to authenticated;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_privileged_member() to authenticated;
grant execute on function public.can_access_driver(uuid) to authenticated;
grant execute on function public.bootstrap_company(text, text) to authenticated;
grant execute on function public.create_load_draft(text, text, text, text, integer, numeric, numeric, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.approve_load_draft(uuid) to authenticated;
grant execute on function public.send_offer(uuid, uuid, numeric, numeric, numeric, jsonb) to authenticated;
grant execute on function public.respond_offer(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function public.transition_stop(uuid, public.stop_status, uuid, bigint, timestamptz, numeric, numeric) to authenticated;
grant execute on function public.complete_load(uuid) to authenticated;
grant execute on function public.upsert_driver_presence(numeric, numeric, numeric, numeric, boolean) to authenticated;

alter publication supabase_realtime add table public.loads;
alter publication supabase_realtime add table public.load_stops;
alter publication supabase_realtime add table public.offers;
alter publication supabase_realtime add table public.assignments;
alter publication supabase_realtime add table public.document_checks;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.driver_presence;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('broker-originals', 'broker-originals', false, 52428800),
  ('load-documents', 'load-documents', false, 52428800)
on conflict (id) do nothing;

create policy storage_company_read on storage.objects for select to authenticated
using (
  bucket_id in ('broker-originals', 'load-documents')
  and (storage.foldername(name))[1] = public.current_company_id()::text
);

-- Load documents may be uploaded by authenticated members into their tenant prefix.
create policy storage_company_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'load-documents'
  and (storage.foldername(name))[1] = public.current_company_id()::text
);
