-- Gmail App Passwords never leave trusted server-side code. Vault stores the
-- credential while public.gmail_connections exposes only operational status.
create extension if not exists supabase_vault with schema vault;

alter table public.gmail_connections
  add column if not exists configuration_version bigint not null default 1
  check (configuration_version >= 1);

create or replace function public.configure_gmail_app_password(
  requested_by uuid,
  mailbox_email text,
  app_password text
)
returns public.gmail_connections
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  actor public.profiles;
  existing_connection public.gmail_connections;
  saved_connection public.gmail_connections;
  normalized_email text := lower(trim(configure_gmail_app_password.mailbox_email));
  normalized_password text := regexp_replace(configure_gmail_app_password.app_password, '\s+', '', 'g');
  secret_id uuid;
begin
  select * into actor
  from public.profiles
  where id = configure_gmail_app_password.requested_by
    and status = 'active';

  if actor.id is null or actor.role <> 'company_admin' or actor.company_id is null then
    raise exception 'Company admin permission required';
  end if;
  if normalized_email !~* '^[^@[:space:]]+@gmail\.com$' then
    raise exception 'A valid Gmail address is required';
  end if;
  if normalized_password !~ '^[A-Za-z0-9]{16}$' then
    raise exception 'Google App Password must contain 16 characters';
  end if;

  -- One company owns one mailbox. Serialize first-time saves so concurrent
  -- requests cannot create an unused Vault secret before the unique upsert.
  perform pg_advisory_xact_lock(hashtextextended(actor.company_id::text, 0));

  select * into existing_connection
  from public.gmail_connections
  where company_id = actor.company_id
  for update;

  if existing_connection.secret_reference ~ '^vault:[0-9a-f-]{36}$' then
    secret_id := substring(existing_connection.secret_reference from 7)::uuid;
    perform vault.update_secret(
      secret_id,
      normalized_password,
      format('gmail-app-password-%s', actor.company_id),
      format('Gmail App Password for %s', normalized_email)
    );
  else
    secret_id := vault.create_secret(
      normalized_password,
      format('gmail-app-password-%s', actor.company_id),
      format('Gmail App Password for %s', normalized_email)
    );
  end if;

  insert into public.gmail_connections (
    company_id,
    mailbox_email,
    status,
    secret_reference,
    created_by,
    provider_history_id,
    watch_expires_at,
    last_synced_at,
    last_error
  ) values (
    actor.company_id,
    normalized_email,
    'needs_reconnect',
    'vault:' || secret_id,
    actor.id,
    null,
    null,
    null,
    null
  )
  on conflict on constraint gmail_connections_company_id_key do update set
    mailbox_email = excluded.mailbox_email,
    status = 'needs_reconnect',
    secret_reference = excluded.secret_reference,
    provider_history_id = case
      when gmail_connections.mailbox_email = excluded.mailbox_email
        then gmail_connections.provider_history_id
      else null
    end,
    last_synced_at = case
      when gmail_connections.mailbox_email = excluded.mailbox_email
        then gmail_connections.last_synced_at
      else null
    end,
    watch_expires_at = null,
    last_error = null,
    configuration_version = gmail_connections.configuration_version + 1,
    updated_at = now()
  returning * into saved_connection;

  insert into public.audit_events (
    company_id, actor_id, action, entity_type, entity_id, new_value, metadata
  ) values (
    actor.company_id,
    actor.id,
    'gmail.connection.configured',
    'gmail_connection',
    saved_connection.id,
    jsonb_build_object('mailbox_email', normalized_email, 'status', saved_connection.status),
    jsonb_build_object('credential_store', 'vault')
  );

  return saved_connection;
end;
$$;

create or replace function public.disconnect_gmail_connection(requested_by uuid)
returns public.gmail_connections
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  actor public.profiles;
  saved_connection public.gmail_connections;
  secret_id uuid;
begin
  select * into actor
  from public.profiles
  where id = disconnect_gmail_connection.requested_by
    and status = 'active';

  if actor.id is null or actor.role <> 'company_admin' or actor.company_id is null then
    raise exception 'Company admin permission required';
  end if;

  select * into saved_connection
  from public.gmail_connections
  where company_id = actor.company_id
  for update;

  if saved_connection.id is null then
    raise exception 'Gmail connection not found';
  end if;

  if saved_connection.secret_reference ~ '^vault:[0-9a-f-]{36}$' then
    secret_id := substring(saved_connection.secret_reference from 7)::uuid;
    delete from vault.secrets where id = secret_id;
  end if;

  update public.gmail_connections set
    status = 'disabled',
    secret_reference = 'disconnected',
    provider_history_id = null,
    watch_expires_at = null,
    last_error = null,
    configuration_version = gmail_connections.configuration_version + 1,
    updated_at = now()
  where id = saved_connection.id
  returning * into saved_connection;

  insert into public.audit_events (
    company_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    actor.company_id,
    actor.id,
    'gmail.connection.disconnected',
    'gmail_connection',
    saved_connection.id,
    jsonb_build_object('mailbox_email', saved_connection.mailbox_email, 'status', saved_connection.status)
  );

  return saved_connection;
end;
$$;

create or replace function public.get_gmail_worker_credentials(target_company_id uuid)
returns table (
  connection_id uuid,
  mailbox_email text,
  app_password text,
  provider_history_id text,
  configuration_version bigint
)
language sql
security definer
set search_path = public, vault, extensions
as $$
  select
    connection.id,
    connection.mailbox_email,
    secrets.decrypted_secret,
    connection.provider_history_id,
    connection.configuration_version
  from public.gmail_connections connection
  join vault.decrypted_secrets secrets
    on connection.secret_reference = 'vault:' || secrets.id::text
  where connection.company_id = get_gmail_worker_credentials.target_company_id
    and connection.status in ('active', 'needs_reconnect')
  limit 1;
$$;

create or replace function public.ingest_broker_message_guarded(
  gmail_connection_id uuid,
  expected_configuration_version bigint,
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
declare
  guarded_company_id uuid;
begin
  select connection.company_id into guarded_company_id
  from public.gmail_connections connection
  where connection.id = ingest_broker_message_guarded.gmail_connection_id
    and connection.status in ('active', 'needs_reconnect')
    and connection.configuration_version = ingest_broker_message_guarded.expected_configuration_version
  for share;

  if guarded_company_id is null then
    raise exception 'Gmail configuration changed during synchronization';
  end if;

  return public.ingest_broker_message(
    guarded_company_id,
    ingest_broker_message_guarded.gmail_connection_id,
    ingest_broker_message_guarded.provider_message_id,
    ingest_broker_message_guarded.provider_thread_id,
    ingest_broker_message_guarded.from_email,
    ingest_broker_message_guarded.subject,
    ingest_broker_message_guarded.received_at,
    ingest_broker_message_guarded.raw_storage_path
  );
end;
$$;

revoke all on function public.configure_gmail_app_password(uuid, text, text) from public, anon, authenticated;
revoke all on function public.disconnect_gmail_connection(uuid) from public, anon, authenticated;
revoke all on function public.get_gmail_worker_credentials(uuid) from public, anon, authenticated;
revoke all on function public.ingest_broker_message_guarded(uuid, bigint, text, text, text, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.configure_gmail_app_password(uuid, text, text) to service_role;
grant execute on function public.disconnect_gmail_connection(uuid) to service_role;
grant execute on function public.get_gmail_worker_credentials(uuid) to service_role;
grant execute on function public.ingest_broker_message_guarded(uuid, bigint, text, text, text, text, timestamptz, text) to service_role;
