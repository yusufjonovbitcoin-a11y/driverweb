create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('71900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'direct-admin@test.local', '', now(), now(), now()),
  ('71900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'direct-driver1@test.local', '', now(), now(), now()),
  ('71900000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'direct-driver2@test.local', '', now(), now(), now()),
  ('71900000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'foreign-driver@test.local', '', now(), now(), now());

insert into public.companies(id, name) values
  ('a7190000-0000-0000-0000-000000000001', 'Direct Assign Test'),
  ('a7190000-0000-0000-0000-000000000002', 'Foreign Assign Test');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('71900000-0000-0000-0000-000000000001', 'a7190000-0000-0000-0000-000000000001', 'company_admin', 'Direct Admin', 'direct-admin@test.local'),
  ('71900000-0000-0000-0000-000000000002', 'a7190000-0000-0000-0000-000000000001', 'driver', 'Direct Driver One', 'direct-driver1@test.local'),
  ('71900000-0000-0000-0000-000000000003', 'a7190000-0000-0000-0000-000000000001', 'driver', 'Direct Driver Two', 'direct-driver2@test.local'),
  ('71900000-0000-0000-0000-000000000004', 'a7190000-0000-0000-0000-000000000002', 'driver', 'Foreign Driver', 'foreign-driver@test.local');

insert into public.loads(id, company_id, owner_dispatcher_id, load_number, status, broker_rate, loaded_miles)
values ('b7190000-0000-0000-0000-000000000001', 'a7190000-0000-0000-0000-000000000001', '71900000-0000-0000-0000-000000000001', 'DIRECT-1', 'ready_for_offer', 1000, 500);

set local role authenticated;
set local "request.jwt.claim.sub" = '71900000-0000-0000-0000-000000000001';

select extensions.throws_ok(
  $$select public.assign_load_directly('b7190000-0000-0000-0000-000000000001', '71900000-0000-0000-0000-000000000004')$$,
  'P0001', 'Driver is not eligible', 'foreign-company driver cannot be assigned'
);

select extensions.is(
  (public.assign_load_directly('b7190000-0000-0000-0000-000000000001', '71900000-0000-0000-0000-000000000002')).driver_id,
  '71900000-0000-0000-0000-000000000002'::uuid,
  'dispatcher assigns one driver directly'
);
select extensions.is((select status::text from public.loads where id = 'b7190000-0000-0000-0000-000000000001'), 'assigned', 'load enters assigned status');
select extensions.is((select count(*) from public.offers where load_id = 'b7190000-0000-0000-0000-000000000001'), 0::bigint, 'direct assignment creates no offer');
reset role;
select extensions.is((select count(*) from public.notifications where entity_id = 'b7190000-0000-0000-0000-000000000001' and recipient_id = '71900000-0000-0000-0000-000000000002'), 1::bigint, 'driver receives one assignment notification');
set local role authenticated;
select extensions.is((select count(*) from public.assignments where load_id = 'b7190000-0000-0000-0000-000000000001' and status = 'active'), 1::bigint, 'one active assignment exists');

do $$ begin
  perform public.assign_load_directly('b7190000-0000-0000-0000-000000000001', '71900000-0000-0000-0000-000000000002');
end $$;
select extensions.is((select count(*) from public.assignments where load_id = 'b7190000-0000-0000-0000-000000000001'), 1::bigint, 'retrying same driver is idempotent');

select extensions.is(
  (public.assign_load_directly('b7190000-0000-0000-0000-000000000001', '71900000-0000-0000-0000-000000000003')).driver_id,
  '71900000-0000-0000-0000-000000000003'::uuid,
  'reassignment is direct'
);
select extensions.is((select count(*) from public.assignments where load_id = 'b7190000-0000-0000-0000-000000000001' and status = 'active'), 1::bigint, 'reassignment keeps one active driver');

set local "request.jwt.claim.sub" = '71900000-0000-0000-0000-000000000002';
select extensions.throws_ok(
  $$select public.assign_load_directly('b7190000-0000-0000-0000-000000000001', '71900000-0000-0000-0000-000000000002')$$,
  'P0001', 'Dispatcher permission required', 'driver cannot assign loads'
);

select * from extensions.finish();
rollback;
