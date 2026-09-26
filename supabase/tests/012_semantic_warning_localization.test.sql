begin;
create extension if not exists pgtap;
select no_plan();

select ok(
  (
    select is_nullable = 'YES'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'warnings'
      and column_name = 'message'
  ),
  'warning presentation message is optional'
);

select ok(
  (
    select data_type = 'jsonb' and is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'warnings'
      and column_name = 'params'
  ),
  'warning interpolation parameters are stored as required jsonb'
);

select ok(
  pg_get_viewdef('public.document_review_overview'::regclass, true) like '%''params''%w.params%',
  'document review view exposes semantic warning parameters'
);

select ok(
  pg_get_viewdef('public.document_review_overview'::regclass, true) not like '%''message''%w.message%',
  'document review view does not expose warning presentation messages'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_document_check(uuid,public.document_check_status,numeric,text,jsonb,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'authenticated users cannot execute the security-definer warning recorder'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_document_check(uuid,public.document_check_status,numeric,text,jsonb,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'anonymous users cannot execute the security-definer warning recorder'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_document_check(uuid,public.document_check_status,numeric,text,jsonb,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'service role can execute the warning recorder'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '12000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'warning-test@example.test', '',
  now(), now(), now()
);
insert into public.companies(id, name) values (
  'a1200000-0000-0000-0000-000000000001', 'Warning Contract Test'
);
insert into public.profiles(id, company_id, role, full_name, email) values (
  '12000000-0000-0000-0000-000000000001',
  'a1200000-0000-0000-0000-000000000001',
  'dispatcher', 'Warning Tester', 'warning-test@example.test'
);
insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values (
  'b1200000-0000-0000-0000-000000000001',
  'a1200000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'WARNING-TEST-1', 'review', 0, 0
);
insert into public.documents(
  id, company_id, load_id, document_type, created_by
) values (
  'd1200000-0000-0000-0000-000000000001',
  'a1200000-0000-0000-0000-000000000001',
  'b1200000-0000-0000-0000-000000000001',
  'rate_confirmation',
  '12000000-0000-0000-0000-000000000001'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name,
  mime_type, storage_path, uploaded_by
) values (
  'd1200000-0000-0000-0000-000000000002',
  'a1200000-0000-0000-0000-000000000001',
  'd1200000-0000-0000-0000-000000000001',
  1, 'warning.pdf', 'application/pdf', 'warning/test.pdf',
  '12000000-0000-0000-0000-000000000001'
);
update public.documents
set current_version_id = 'd1200000-0000-0000-0000-000000000002'
where id = 'd1200000-0000-0000-0000-000000000001';
insert into public.document_checks(
  id, company_id, document_version_id, status
) values (
  'c1200000-0000-0000-0000-000000000001',
  'a1200000-0000-0000-0000-000000000001',
  'd1200000-0000-0000-0000-000000000002',
  'queued'
);

set local role service_role;
select lives_ok(
  $$
    select public.record_document_check(
      'c1200000-0000-0000-0000-000000000001',
      'warning',
      0.5,
      'test-model',
      '{"missingFields":["brokerRate"]}'::jsonb,
      '[{"code":"ai_missing_field","message":"SHOULD NOT PERSIST","params":{"field":"brokerRate"}}]'::jsonb
    )
  $$,
  'service role records a semantic warning'
);
reset role;

select is(
  (select message from public.warnings where document_check_id = 'c1200000-0000-0000-0000-000000000001'),
  null::text,
  'warning recorder discards presentation messages'
);
select is(
  (select params->>'field' from public.warnings where document_check_id = 'c1200000-0000-0000-0000-000000000001'),
  'brokerRate',
  'warning recorder preserves semantic parameters'
);
select ok(
  not (
    select active_warnings->0 ? 'message'
    from public.document_review_overview
    where document_id = 'd1200000-0000-0000-0000-000000000001'
  ),
  'document review response omits presentation message'
);
select is(
  (
    select active_warnings->0->'params'->>'field'
    from public.document_review_overview
    where document_id = 'd1200000-0000-0000-0000-000000000001'
  ),
  'brokerRate',
  'document review response exposes semantic parameters'
);

select * from finish();
rollback;
