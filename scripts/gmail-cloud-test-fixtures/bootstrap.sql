-- Isolated contract fixture, not a production schema migration. Mirrors the
-- Gmail columns used by the new RPCs; no secrets, real mail or network access.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant usage on schema public to anon, authenticated, service_role;
create table public.companies(id uuid primary key);
create table public.gmail_connections (
  id uuid primary key, company_id uuid not null unique references public.companies(id),
  status text not null default 'active', configuration_version bigint not null default 1,
  provider_history_id text, last_synced_at timestamptz, last_error text
);
alter table public.gmail_connections enable row level security;
create policy gmail_service_fixture on public.gmail_connections
  for all to service_role using (true) with check (true);
grant select, update on public.gmail_connections to service_role;
create type public.job_status as enum ('pending','processing','completed','failed','dead_letter');
create table public.jobs (
  id uuid primary key, company_id uuid references public.companies(id), type text not null,
  status public.job_status not null default 'pending', attempt_count integer not null default 0,
  max_attempts integer not null default 8, available_at timestamptz not null default now(),
  locked_at timestamptz, locked_by text, last_error text
);
create table public.broker_messages (
  id uuid primary key, company_id uuid not null references public.companies(id),
  gmail_connection_id uuid, status text not null default 'queued'
);
create table public.broker_attachments (
  id uuid primary key, company_id uuid not null references public.companies(id),
  message_id uuid not null references public.broker_messages(id), mime_type text not null,
  created_at timestamptz not null default now(), ai_last_attempt_at timestamptz
);
create table public.ai_extractions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  message_id uuid not null references public.broker_messages(id),
  attachment_id uuid references public.broker_attachments(id), status text not null, processed_at timestamptz
);
grant select, update on public.jobs to service_role;
grant select on public.broker_messages,public.broker_attachments,public.ai_extractions to service_role;
create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', label; end if; end;
$$;
