-- Only Edge Functions can access OAuth material or fleet snapshots. Browser access
-- goes through an authenticated company-admin handler, never a public table read.
create table public.samsara_connections (
  company_id uuid primary key references public.companies(id) on delete cascade,
  connected_by uuid references public.profiles(id) on delete set null,
  status text not null default 'disconnected' check (status in ('active','needs_reconnect','disconnected')),
  generation uuid not null default gen_random_uuid(),
  oauth_attempt uuid,
  credentials text,
  expires_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  next_sync_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.samsara_oauth_states (
  state_hash text primary key,
  attempt_id uuid not null,
  company_id uuid not null references public.samsara_connections(company_id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  return_origin text not null,
  expires_at timestamptz not null
);
create index samsara_states_expiry on public.samsara_oauth_states(expires_at);
alter table public.samsara_connections enable row level security;
alter table public.samsara_oauth_states enable row level security;
revoke all on public.samsara_connections, public.samsara_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.samsara_connections, public.samsara_oauth_states to service_role;

-- Serialize token refresh, sync and disconnect across tabs and worker instances.
create function public.claim_samsara_connection(p_company uuid, p_lease uuid)
returns setof public.samsara_connections language sql security invoker set search_path = '' as $$
  update public.samsara_connections set lease_id=p_lease,
    lease_until=now()+interval '4 minutes'
  where company_id=p_company and credentials is not null
    and status in ('active','needs_reconnect')
    and (lease_until is null or lease_until < now())
  returning *;
$$;
revoke all on function public.claim_samsara_connection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_samsara_connection(uuid,uuid) to service_role;

-- No HTTP requests while disconnected. Worker token is provisioned in Vault,
-- separately from migrations/source control. This does not modify other jobs.
create schema if not exists samsara_private;
revoke all on schema samsara_private from public,anon,authenticated,service_role;
create function samsara_private.invoke_sync() returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_token text; v_request bigint;
begin
  delete from public.samsara_oauth_states where expires_at < now();
  if not exists(select 1 from public.samsara_connections where status='active'
    and next_sync_at <= now() and (lease_until is null or lease_until < now())) then return 0; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='samsara_worker_token';
  if v_token is null then return 0; end if;
  select net.http_post(
    url := 'https://gsnbjpqwwpvqtmphsyfs.supabase.co/functions/v1/samsara-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-worker-token',v_token),
    body := '{}'::jsonb, timeout_milliseconds := 10000
  ) into v_request;
  return v_request;
end;
$$;
revoke all on function samsara_private.invoke_sync() from public,anon,authenticated,service_role;
select cron.schedule('samsara-fleet-sync','*/2 * * * *','select samsara_private.invoke_sync()');
