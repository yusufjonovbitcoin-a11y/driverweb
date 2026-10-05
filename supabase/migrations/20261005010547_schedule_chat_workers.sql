-- Credentials are provisioned separately; never put token values in migrations
-- or cron.job.command. Schedules are enabled only after the workers pass smoke tests.
create extension if not exists pg_net with schema extensions;

create schema if not exists worker_cron authorization postgres;
revoke all on schema worker_cron from public, anon, authenticated, service_role;

-- Bounded operational state, not a growing request log. HTTP results remain in
-- net._http_response for pg_net's normal retention period.
create table worker_cron.last_invocations (
  worker text primary key check (worker in ('push', 'media')),
  request_id bigint not null,
  requested_at timestamptz not null default now()
);
alter table worker_cron.last_invocations enable row level security;
revoke all on worker_cron.last_invocations from public, anon, authenticated, service_role;

create function worker_cron.invoke(worker_name text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  secret_name text;
  endpoint text;
  project_url text;
  worker_token text;
  new_request_id bigint;
begin
  case worker_name
    when 'push' then
      secret_name := 'chat_push_cron_token';
      endpoint := 'process-push-notifications';
    when 'media' then
      secret_name := 'chat_media_cron_token';
      endpoint := 'process-media-deletions';
    else
      raise exception 'Unknown scheduled worker';
  end case;

  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'chat_cron_project_url';
  select decrypted_secret into worker_token
    from vault.decrypted_secrets where name = secret_name;

  -- Do not permit credentials to be sent to arbitrary URLs or invalid config.
  if project_url is null or project_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'Cron project URL is missing or invalid';
  end if;
  if worker_token is null or worker_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Cron worker token is missing or invalid';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/' || endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Worker-Token', worker_token),
    body := '{"batchSize":3}'::jsonb,
    timeout_milliseconds := 60000
  ) into new_request_id;

  insert into worker_cron.last_invocations(worker, request_id, requested_at)
    values (worker_name, new_request_id, clock_timestamp())
    on conflict (worker) do update
      set request_id = excluded.request_id, requested_at = excluded.requested_at;
  return new_request_id;
end;
$$;

revoke all on function worker_cron.invoke(text) from public, anon, authenticated, service_role;
comment on function worker_cron.invoke(text) is
  'Postgres-only Cron entrypoint. Resolves its dedicated worker credential from Vault at invocation time.';
