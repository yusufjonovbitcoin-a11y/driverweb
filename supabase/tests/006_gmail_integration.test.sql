create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('46000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@gmail.test', '', now(), now(), now()),
  ('46000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver@gmail.test', '', now(), now(), now());

insert into public.companies(id, name)
values ('a6000000-0000-0000-0000-000000000001', 'Gmail Integration Company');

insert into public.profiles(id, company_id, role, status, full_name, email)
values
  ('46000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'company_admin', 'active', 'Gmail Admin', 'admin@gmail.test'),
  ('46000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001', 'driver', 'active', 'Gmail Driver', 'driver@gmail.test');

set local role service_role;

select extensions.ok(
  not has_function_privilege('authenticated', 'public.configure_gmail_app_password(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.configure_gmail_app_password(uuid,text,text)', 'EXECUTE'),
  'browser roles cannot execute the Vault write command'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.get_gmail_worker_credentials(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_gmail_worker_credentials(uuid)', 'EXECUTE'),
  'browser roles cannot read Gmail worker credentials'
);

select extensions.throws_ok(
  $$select public.configure_gmail_app_password(
    '46000000-0000-0000-0000-000000000002',
    'loads@gmail.com',
    'abcdefghijklmnop'
  )$$,
  'P0001',
  'Company admin permission required',
  'driver cannot configure company Gmail'
);

select extensions.lives_ok(
  $$select public.configure_gmail_app_password(
    '46000000-0000-0000-0000-000000000001',
    'Loads@Gmail.com',
    'abcd efgh ijkl mnop'
  )$$,
  'company admin stores a normalized Gmail App Password'
);

select extensions.is(
  (select mailbox_email from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  'loads@gmail.com',
  'mailbox email is normalized'
);
select extensions.is(
  (select status::text from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  'needs_reconnect',
  'new credentials wait for worker verification'
);
select extensions.ok(
  (select secret_reference ~ '^vault:[0-9a-f-]{36}$' from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  'connection stores only a Vault reference'
);
select extensions.is(
  (select app_password from public.get_gmail_worker_credentials('a6000000-0000-0000-0000-000000000001')),
  'abcdefghijklmnop',
  'service worker receives the normalized Vault credential'
);

update public.gmail_connections
set provider_history_id = '42', last_synced_at = '2026-09-26 12:00:00+00'
where company_id = 'a6000000-0000-0000-0000-000000000001';

select public.configure_gmail_app_password(
  '46000000-0000-0000-0000-000000000001',
  'loads@gmail.com',
  'ponmlkjihgfedcba'
);
select extensions.is(
  (select provider_history_id from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  '42',
  'same mailbox keeps the IMAP cursor'
);
select extensions.is(
  (select last_synced_at from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  '2026-09-26 12:00:00+00'::timestamptz,
  'saving the same mailbox does not fake a new sync time'
);
select extensions.is(
  (select app_password from public.get_gmail_worker_credentials('a6000000-0000-0000-0000-000000000001')),
  'ponmlkjihgfedcba',
  'updating the integration rotates the Vault credential'
);

select public.configure_gmail_app_password(
  '46000000-0000-0000-0000-000000000001',
  'dispatch@gmail.com',
  '1234567890abcdef'
);
select extensions.is(
  (select provider_history_id from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  null::text,
  'changing mailbox resets the IMAP cursor'
);
select extensions.is(
  (select last_synced_at from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'changing mailbox clears the prior sync time'
);

create temporary table gmail_sync_snapshot(configuration_version bigint);
insert into gmail_sync_snapshot
select configuration_version from public.gmail_connections
where company_id = 'a6000000-0000-0000-0000-000000000001';

select extensions.lives_ok(
  $$select public.disconnect_gmail_connection('46000000-0000-0000-0000-000000000001')$$,
  'company admin disconnects Gmail'
);
select extensions.is(
  (select status::text from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
  'disabled',
  'disconnect disables the connection'
);
select extensions.throws_ok(
  format(
    $$select public.ingest_broker_message_guarded(
      '%s', %s::bigint, 'stale-message', null, 'broker@example.test',
      'Stale message', now(), null
    )$$,
    (select id from public.gmail_connections where company_id = 'a6000000-0000-0000-0000-000000000001'),
    (select configuration_version from gmail_sync_snapshot)
  ),
  'P0001',
  'Gmail configuration changed during synchronization',
  'a disconnected integration rejects in-flight worker ingestion'
);
select extensions.is(
  (select count(*) from public.get_gmail_worker_credentials('a6000000-0000-0000-0000-000000000001')),
  0::bigint,
  'disabled connection exposes no worker credential'
);

select * from extensions.finish();
rollback;
