-- Managed pg_net objects belong to supabase_admin; postgres REVOKE statements
-- did not change their effective PUBLIC ACLs. Never enqueue bearer secrets there.
-- Use a bounded synchronous request from Cron instead; no request headers persist.
create extension if not exists http with schema extensions;

alter table worker_cron.last_invocations
  add column http_status integer,
  add column response_summary jsonb,
  add column completed_at timestamptz;

create or replace function worker_cron.invoke(worker_name text)
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
  started_at timestamptz := clock_timestamp();
  invocation_id bigint := (extract(epoch from clock_timestamp()) * 1000000)::bigint;
  result extensions.http_response;
  summary jsonb := '{}'::jsonb;
  payload jsonb;
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
  if project_url is null or project_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'Cron project URL is missing or invalid';
  end if;
  if worker_token is null or worker_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Cron worker token is missing or invalid';
  end if;

  begin
    -- Load the C extension first: custom GUCs are not registered merely by
    -- CREATE EXTENSION and a fresh Cron connection cannot SET them beforehand.
    perform 1 from extensions.http_list_curlopt();
    perform set_config('http.curlopt_timeout_ms', '55000', true);
    perform set_config('http.curlopt_connecttimeout_ms', '10000', true);
    -- TLS controls are superuser-only in pgsql-http. Preserve its secure
    -- defaults and fail closed if an administrator has disabled verification.
    if coalesce(nullif(current_setting('http.curlopt_ssl_verifyhost', true), ''), '2') <> '2'
       or coalesce(nullif(current_setting('http.curlopt_ssl_verifypeer', true), ''), '1') <> '1' then
      raise exception 'TLS verification must remain enabled';
    end if;
    select * into result from extensions.http(row(
      'POST', project_url || '/functions/v1/' || endpoint,
      array[row('X-Worker-Token', worker_token)::extensions.http_header],
      'application/json', '{"batchSize":3}'
    )::extensions.http_request);
    begin
      payload := result.content::jsonb;
      -- No provider text, URLs, headers or arbitrary response bodies are stored.
      select coalesce(jsonb_object_agg(key,value), '{}'::jsonb) into summary
        from jsonb_each(payload)
        where key in ('claimed','completed','failed','cancelled','transitionFailures')
          and jsonb_typeof(value) = 'number';
      if jsonb_typeof(payload->'deadlineReached') = 'boolean' then
        summary := summary || jsonb_build_object('deadlineReached',payload->'deadlineReached');
      end if;
      if jsonb_typeof(payload->'maintenance') = 'object' then
        summary := summary || jsonb_build_object('maintenance', (
          select coalesce(jsonb_object_agg(key,value), '{}'::jsonb)
            from jsonb_each(payload->'maintenance')
            where key in ('expiredUploads','staleJobs','expiredRateLimits','staleCalls')
              and jsonb_typeof(value) = 'number'
        ));
      end if;
    exception when others then
      summary := '{"invalidResponse":true}'::jsonb;
    end;
  exception when others then
    result.status := 0;
    summary := '{"transportError":true}'::jsonb;
  end;

  insert into worker_cron.last_invocations
    (worker, request_id, requested_at, http_status, response_summary, completed_at)
    values (worker_name, invocation_id, started_at, result.status, summary, clock_timestamp())
    on conflict (worker) do update set
      request_id = excluded.request_id, requested_at = excluded.requested_at,
      http_status = excluded.http_status, response_summary = excluded.response_summary,
      completed_at = excluded.completed_at;
  return invocation_id;
end;
$$;
revoke all on function worker_cron.invoke(text) from public, anon, authenticated, service_role;
comment on function worker_cron.invoke(text) is
  'Postgres-only synchronous Cron request; dedicated Vault credential stays in memory; inspect last_invocations for HTTP outcome.';
