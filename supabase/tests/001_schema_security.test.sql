create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

select extensions.has_table('public', 'companies', 'companies table exists');
select extensions.has_table('public', 'loads', 'loads table exists');
select extensions.has_table('public', 'offers', 'offers table exists');
select extensions.has_table('public', 'assignments', 'assignments table exists');
select extensions.has_table('public', 'documents', 'documents table exists');
select extensions.has_table('public', 'jobs', 'worker job table exists');
select extensions.has_table('public', 'audit_events', 'audit table exists');
select extensions.has_table('public', 'dispatcher_preferences', 'dispatcher scope table exists');
select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_directory' and column_name = 'hos_available_minutes'
  ),
  'driver directory exposes HOS availability to authorized dispatchers'
);

select extensions.has_function('public', 'send_offer', array['uuid', 'uuid', 'numeric', 'numeric', 'numeric', 'jsonb'], 'send_offer command exists');
select extensions.has_function('public', 'respond_offer', array['uuid', 'text', 'uuid', 'timestamp with time zone'], 'respond_offer command exists');
select extensions.has_function('public', 'transition_stop', array['uuid', 'stop_status', 'uuid', 'bigint', 'timestamp with time zone', 'numeric', 'numeric'], 'transition_stop command exists');
select extensions.has_function('public', 'record_ai_extraction', array['uuid', 'uuid', 'ingestion_status', 'text', 'integer', 'jsonb', 'jsonb', 'text'], 'AI worker command exists');

select extensions.ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in ('profiles', 'loads', 'offers', 'assignments', 'documents', 'warnings', 'driver_presence')),
  'all client-facing tables have RLS enabled'
);

select extensions.ok(not has_table_privilege('authenticated', 'public.loads', 'INSERT'), 'authenticated cannot insert loads directly');
select extensions.ok(not has_table_privilege('authenticated', 'public.loads', 'UPDATE'), 'authenticated cannot update load status directly');
select extensions.ok(not has_table_privilege('authenticated', 'public.offers', 'INSERT'), 'authenticated cannot insert offers directly');
select extensions.ok(not has_table_privilege('authenticated', 'public.assignments', 'INSERT'), 'authenticated cannot create assignments directly');
select extensions.ok(not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE'), 'authenticated cannot update audit events');
select extensions.ok(not has_table_privilege('authenticated', 'public.jobs', 'SELECT'), 'authenticated cannot read worker jobs');
select extensions.ok(not has_function_privilege('authenticated', 'public.record_ai_extraction(uuid,uuid,public.ingestion_status,text,integer,jsonb,jsonb,text)', 'EXECUTE'), 'AI worker command is service-only');
select extensions.ok(has_function_privilege('service_role', 'public.record_ai_extraction(uuid,uuid,public.ingestion_status,text,integer,jsonb,jsonb,text)', 'EXECUTE'), 'service role can record AI extraction');
select extensions.ok(
  to_regprocedure('public.register_company_member(uuid,uuid,public.app_role,text,text,text)') is null,
  'legacy unrestricted registration function is removed'
);
select extensions.ok(
  to_regprocedure('public.bootstrap_company(text,text)') is null,
  'authenticated self-service company bootstrap is removed'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.create_company_with_admin(uuid,text,uuid,text,text,text)', 'EXECUTE'),
  'service worker can create a company through the super-admin command'
);

insert into public.audit_events(action, entity_type, entity_id)
values ('test.created', 'test', '00000000-0000-0000-0000-000000000099');

select extensions.throws_ok(
  $$delete from public.audit_events where entity_id = '00000000-0000-0000-0000-000000000099'$$,
  'P0001',
  'audit_events is append-only',
  'audit events cannot be deleted even by the database owner'
);

select * from extensions.finish();
rollback;
