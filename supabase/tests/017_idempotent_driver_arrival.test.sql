create extension if not exists pgtap with schema extensions;

begin;
select extensions.plan(10);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('17000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dispatcher@arrival.test', '', now(), now(), now()),
  ('17000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver@arrival.test', '', now(), now(), now());

insert into public.companies(id, name)
values ('a7000000-0000-0000-0000-000000000001', 'Arrival Reconciliation');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('17000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'dispatcher', 'Arrival Dispatcher', 'dispatcher@arrival.test'),
  ('17000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'driver', 'Arrival Driver', 'driver@arrival.test');

insert into public.driver_profiles(user_id, company_id)
values ('17000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001');

insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status, broker_rate,
  loaded_miles, version
) values (
  'b7000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0000-000000000001',
  'ARRIVAL-RETRY-1', 'in_progress', 1000, 500, 1
);

insert into public.load_stops(
  id, company_id, load_id, type, sequence, address_line, city, region, status
) values
  ('c7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'pickup', 1, '1 Origin Rd', 'Boise', 'ID', 'pending'),
  ('c7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'delivery', 2, '2 Destination Ave', 'Reno', 'NV', 'pending');

insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by, driver_stage
) values (
  'd7000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0000-000000000002',
  'active', '17000000-0000-0000-0000-000000000001', 'en_route_to_pickup'
);

update public.loads
set current_assignment_id = 'd7000000-0000-0000-0000-000000000001'
where id = 'b7000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = '17000000-0000-0000-0000-000000000002';

select extensions.lives_ok(
  $$select public.transition_stop(
    'c7000000-0000-0000-0000-000000000001',
    'arrived',
    'e7000000-0000-0000-0000-000000000001',
    1
  )$$,
  'legacy pickup arrival command records the stop first'
);
select extensions.lives_ok(
  format(
    $$select public.advance_driver_stage(
      'b7000000-0000-0000-0000-000000000001',
      'arrived_at_pickup',
      'e7000000-0000-0000-0000-000000000002',
      %s
    )$$,
    (select version from public.loads where id = 'b7000000-0000-0000-0000-000000000001')
  ),
  'pickup arrival reconciles when the stop was already marked arrived'
);
select extensions.is(
  (select driver_stage from public.assignments where id = 'd7000000-0000-0000-0000-000000000001'),
  'arrived_at_pickup',
  'pickup reconciliation advances the assignment stage'
);
select extensions.is(
  (select status::text from public.load_stops where id = 'c7000000-0000-0000-0000-000000000001'),
  'arrived',
  'pickup reconciliation preserves the arrived stop'
);

reset role;
update public.assignments
set driver_stage = 'in_transit'
where id = 'd7000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '17000000-0000-0000-0000-000000000002';

select extensions.lives_ok(
  format(
    $$select public.transition_stop(
      'c7000000-0000-0000-0000-000000000002',
      'arrived',
      'e7000000-0000-0000-0000-000000000003',
      %s
    )$$,
    (select version from public.loads where id = 'b7000000-0000-0000-0000-000000000001')
  ),
  'legacy delivery arrival command records the stop first'
);
select extensions.lives_ok(
  format(
    $$select public.advance_driver_stage(
      'b7000000-0000-0000-0000-000000000001',
      'arrived_at_delivery',
      'e7000000-0000-0000-0000-000000000004',
      %s
    )$$,
    (select version from public.loads where id = 'b7000000-0000-0000-0000-000000000001')
  ),
  'delivery arrival reconciles when the stop was already marked arrived'
);
select extensions.is(
  (select driver_stage from public.assignments where id = 'd7000000-0000-0000-0000-000000000001'),
  'arrived_at_delivery',
  'delivery reconciliation advances the assignment stage'
);
select extensions.is(
  (select status::text from public.load_stops where id = 'c7000000-0000-0000-0000-000000000002'),
  'arrived',
  'delivery reconciliation preserves the arrived stop'
);

reset role;
select extensions.ok(
  strpos(
    pg_get_functiondef('public.transition_stop(uuid,public.stop_status,uuid,bigint,timestamptz,numeric,numeric)'::regprocedure),
    'select * into target_load'
  ) < strpos(
    pg_get_functiondef('public.transition_stop(uuid,public.stop_status,uuid,bigint,timestamptz,numeric,numeric)'::regprocedure),
    'select * into target_stop'
  ),
  'legacy stop transition locks the load before locking the stop'
);
select extensions.ok(
  strpos(
    pg_get_functiondef('public.advance_driver_stage(uuid,text,uuid,bigint,timestamptz,numeric,numeric)'::regprocedure),
    'select * into target_load'
  ) < strpos(
    pg_get_functiondef('public.advance_driver_stage(uuid,text,uuid,bigint,timestamptz,numeric,numeric)'::regprocedure),
    'select * into target_stop'
  ),
  'driver stage transition locks the load before locking a stop'
);

select * from extensions.finish();
rollback;
