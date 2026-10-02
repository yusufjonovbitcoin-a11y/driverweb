begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), now(), now()
from (values
  ('b1100000-0000-0000-0000-000000000001'::uuid, 'tracking-admin@test.local'),
  ('b1100000-0000-0000-0000-000000000002'::uuid, 'tracking-driver@test.local'),
  ('b1100000-0000-0000-0000-000000000003'::uuid, 'tracking-other@test.local')
) as users(id, email);

insert into public.companies(id, name)
values ('b1200000-0000-0000-0000-000000000001', 'Tracking fixture');
insert into public.profiles(id, company_id, role, status, full_name, email) values
  ('b1100000-0000-0000-0000-000000000001', 'b1200000-0000-0000-0000-000000000001', 'company_admin', 'active', 'Admin', 'tracking-admin@test.local'),
  ('b1100000-0000-0000-0000-000000000002', 'b1200000-0000-0000-0000-000000000001', 'driver', 'active', 'Driver', 'tracking-driver@test.local'),
  ('b1100000-0000-0000-0000-000000000003', 'b1200000-0000-0000-0000-000000000001', 'driver', 'active', 'Other', 'tracking-other@test.local');
insert into public.loads(id, company_id, owner_dispatcher_id, load_number, status, broker_rate, loaded_miles)
values ('b1300000-0000-0000-0000-000000000001',
        'b1200000-0000-0000-0000-000000000001',
        'b1100000-0000-0000-0000-000000000001',
        'TRACK-1', 'assigned', 100, 10);
insert into public.assignments(id, company_id, load_id, driver_id, status, assigned_by)
values ('b1400000-0000-0000-0000-000000000001',
        'b1200000-0000-0000-0000-000000000001',
        'b1300000-0000-0000-0000-000000000001',
        'b1100000-0000-0000-0000-000000000002',
        'active',
        'b1100000-0000-0000-0000-000000000001');
update public.loads
set current_assignment_id = 'b1400000-0000-0000-0000-000000000001'
where id = 'b1300000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = 'b1100000-0000-0000-0000-000000000002';
select extensions.is(
  (select assignment_id from public.current_driver_tracking_assignment()),
  'b1400000-0000-0000-0000-000000000001'::uuid,
  'active driver resolves only their assigned load');
select extensions.is(
  public.ingest_driver_location_batch(
    'b1400000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'b1500000-0000-0000-0000-000000000001',
      'captured_at', now(), 'latitude', 39.6542,
      'longitude', 66.9597, 'accuracy_m', 15
    ))
  ),
  1, 'first batch inserts one point');
select extensions.is(
  public.ingest_driver_location_batch(
    'b1400000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'b1500000-0000-0000-0000-000000000001',
      'captured_at', now(), 'latitude', 39.6542,
      'longitude', 66.9597, 'accuracy_m', 15
    ))
  ),
  0, 'retry is idempotent');
select extensions.throws_ok(
  format($$select public.ingest_driver_location_batch(
    'b1400000-0000-0000-0000-000000000001',
    '[{"id":"b1500000-0000-0000-0000-000000000002","captured_at":"%s","latitude":100,"longitude":66,"accuracy_m":15}]'::jsonb
  )$$, now()),
  '23514', null, 'invalid latitude is rejected by the table constraint');
select extensions.is((select count(*) from public.driver_location_points), 1::bigint,
  'failed batch leaves the existing point intact');

reset role;
update public.assignments
set status = 'completed', ended_at = now(), driver_stage = 'completed'
where id = 'b1400000-0000-0000-0000-000000000001';
update public.loads set status = 'completed'
where id = 'b1300000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b1100000-0000-0000-0000-000000000002';
select extensions.is((select count(*) from public.current_driver_tracking_assignment()), 0::bigint,
  'completed assignment stops live tracking');
select extensions.is(
  public.ingest_driver_location_batch(
    'b1400000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'b1500000-0000-0000-0000-000000000004',
      'captured_at', now(), 'latitude', 39.6543,
      'longitude', 66.9598, 'accuracy_m', 15
    ))
  ),
  1, 'offline queue can finish uploading after the assignment ends');
select extensions.is(
  public.ingest_driver_location_batch(
    'b1400000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'b1500000-0000-0000-0000-000000000005',
      'captured_at', now() + interval '3 minutes', 'latitude', 39.6544,
      'longitude', 66.9599, 'accuracy_m', 15
    ))
  ),
  0, 'samples after the completed assignment window are discarded');

set local "request.jwt.claim.sub" = 'b1100000-0000-0000-0000-000000000003';
select extensions.is((select count(*) from public.driver_location_points), 0::bigint,
  'unassigned driver cannot read another drivers route');
select extensions.throws_ok(
  $$select public.ingest_driver_location_batch(
    'b1400000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'b1500000-0000-0000-0000-000000000003',
      'captured_at', now(), 'latitude', 39.6542,
      'longitude', 66.9597, 'accuracy_m', 15
    ))
  )$$,
  'P0001', null, 'unassigned driver cannot upload tracking points');

set local "request.jwt.claim.sub" = 'b1100000-0000-0000-0000-000000000001';
select extensions.is((select count(*) from public.driver_location_points), 2::bigint,
  'company admin can view the route');

select * from extensions.finish();
rollback;
