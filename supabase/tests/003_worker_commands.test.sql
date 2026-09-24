create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dispatch@worker.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver@worker.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'forbidden-admin@worker.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'super@worker.test', '', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new-admin@worker.test', '', now(), now(), now());

insert into public.companies(id, name)
values ('a0000000-0000-0000-0000-000000000004', 'Worker Company');
insert into public.profiles(id, company_id, role, full_name, email)
values (
  '40000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000004',
  'dispatcher', 'Worker Dispatcher', 'dispatch@worker.test'
);

create temporary table worker_ids(message_id uuid, extraction_id uuid, job_id uuid);
insert into worker_ids values (null, null, null);
grant all on table worker_ids to service_role;

set local role service_role;

select extensions.lives_ok(
  $$select public.register_super_admin(
    '40000000-0000-0000-0000-000000000004',
    'Platform Owner', 'super@worker.test', null
  )$$,
  'service worker bootstraps the platform super admin'
);
select extensions.lives_ok(
  $$select public.create_company_with_admin(
    '40000000-0000-0000-0000-000000000004',
    'Created By Super Admin',
    '40000000-0000-0000-0000-000000000005',
    'New Company Admin', 'new-admin@worker.test', null
  )$$,
  'super admin creates a company with its first company admin'
);
select extensions.ok(
  (select exists(
    select 1 from public.profiles p join public.companies c on c.id = p.company_id
    where p.id = '40000000-0000-0000-0000-000000000005'
      and p.role = 'company_admin'
      and c.name = 'Created By Super Admin'
  )),
  'new company and company admin are linked'
);

select extensions.lives_ok(
  $$select public.register_company_member_as(
    '40000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000004',
    'driver', 'Worker Driver', 'driver@worker.test', null
  )$$,
  'service worker registers a driver on behalf of a dispatcher'
);
select extensions.ok(
  (select exists(select 1 from public.driver_profiles where user_id = '40000000-0000-0000-0000-000000000002')),
  'driver registration creates the driver profile'
);
select extensions.throws_ok(
  $$select public.register_company_member_as(
    '40000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'company_admin', 'Forbidden Admin', 'forbidden-admin@worker.test', null
  )$$,
  'P0001',
  'Dispatcher may add drivers only',
  'dispatcher cannot create an administrator'
);

select extensions.lives_ok(
  $$select public.register_gmail_connection(
    'a0000000-0000-0000-0000-000000000004',
    'loads@worker.test', 'vault://gmail/worker', '10', now() + interval '6 days',
    '40000000-0000-0000-0000-000000000001'
  )$$,
  'worker registers the company Gmail connection'
);
select extensions.lives_ok(
  $$select public.register_gmail_connection(
    'a0000000-0000-0000-0000-000000000004',
    'new-loads@worker.test', 'vault://gmail/worker-new', '11', now() + interval '6 days',
    '40000000-0000-0000-0000-000000000001'
  )$$,
  'registering Gmail again updates the single company connection'
);
select extensions.is(
  (select count(*) from public.gmail_connections where company_id = 'a0000000-0000-0000-0000-000000000004'),
  1::bigint,
  'one company has exactly one Gmail connection'
);

update worker_ids set message_id = public.ingest_broker_message(
  'a0000000-0000-0000-0000-000000000004',
  (select id from public.gmail_connections where company_id = 'a0000000-0000-0000-0000-000000000004'),
  'gmail-message-1', 'gmail-thread-1', 'broker@example.test', 'Rate confirmation', now(),
  'a0000000-0000-0000-0000-000000000004/gmail-message-1.eml'
);

update worker_ids set extraction_id = (public.record_ai_extraction(
  message_id,
  null,
  'needs_review',
  'extractor-v1',
  1,
  '{"loadNumber":"LOAD-AI-1","rate":2200}'::jsonb,
  '[
    {"name":"loadNumber","value":"LOAD-AI-1","confidence":"0.99","sourceReference":"page:1"},
    {"name":"brokerRate","value":2200,"confidence":"0.82","sourceReference":"page:1"}
  ]'::jsonb,
  null
)).id;

select extensions.is(
  (select status::text from public.broker_messages where id = (select message_id from worker_ids)),
  'needs_review',
  'AI result updates broker message ingestion status'
);
select extensions.is(
  (select count(*) from public.ai_extraction_fields where extraction_id = (select extraction_id from worker_ids)),
  2::bigint,
  'AI result stores field confidence and source references'
);

select extensions.lives_ok(
  format(
    $$select public.record_ai_extraction(
      '%s', null, 'extracted', 'extractor-v2', 2,
      '{"loadNumber":"LOAD-AI-1","rate":2250}'::jsonb,
      '[{"name":"brokerRate","value":2250,"confidence":"0.97","sourceReference":"page:1"}]'::jsonb,
      null
    )$$,
    (select message_id from worker_ids)
  ),
  'AI extraction can be safely retried for the same message'
);
select extensions.is(
  (select count(*) from public.ai_extractions where message_id = (select message_id from worker_ids)),
  1::bigint,
  'AI retry updates instead of duplicating extraction'
);
select extensions.is(
  (select model_name from public.ai_extractions where message_id = (select message_id from worker_ids)),
  'extractor-v2',
  'AI retry keeps the newest model result'
);

select extensions.is(
  (select count(*) from public.claim_jobs('test-worker', array['broker_message.extract'], 10)),
  1::bigint,
  'worker atomically claims the queued extraction job'
);
update worker_ids
set job_id = (
  select id from public.jobs
  where locked_by = 'test-worker' and status = 'processing'
  limit 1
);
select extensions.lives_ok(
  format($$select public.complete_job('%s', 'test-worker')$$, (select job_id from worker_ids)),
  'owning worker completes its claimed job'
);
select extensions.is(
  (select status::text from public.jobs where id = (select job_id from worker_ids)),
  'completed',
  'completed job has terminal status'
);

select * from extensions.finish();
rollback;
