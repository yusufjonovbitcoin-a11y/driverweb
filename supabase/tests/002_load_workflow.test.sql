create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@one.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dispatch@one.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver1@one.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver2@one.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@two.test', '', now(), now(), now());

insert into public.companies(id, name) values
  ('a0000000-0000-0000-0000-000000000001', 'Company One'),
  ('a0000000-0000-0000-0000-000000000002', 'Company Two');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'company_admin', 'Admin One', 'admin@one.test'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'dispatcher', 'Dispatcher One', 'dispatch@one.test'),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'driver', 'Driver One', 'driver1@one.test'),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'driver', 'Driver Two', 'driver2@one.test'),
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'company_admin', 'Admin Two', 'admin@two.test');

insert into public.driver_profiles(user_id, company_id) values
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001');

-- A foreign-tenant row used to prove RLS isolation.
insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status, broker_rate, loaded_miles
) values (
  'b0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'TENANT-TWO-1', 'review', 1000, 500
);

create temporary table test_ids(load_id uuid, offline_offer_id uuid, offer_one_id uuid, offer_two_id uuid);
insert into test_ids values (null, null, null, null);
grant all on table test_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';

select extensions.is(
  public.set_dispatcher_driver_access(
    '10000000-0000-0000-0000-000000000002',
    array['10000000-0000-0000-0000-000000000003'::uuid]
  ),
  1,
  'company admin can assign selected drivers to a dispatcher'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
select extensions.ok(public.can_access_driver('10000000-0000-0000-0000-000000000003'), 'dispatcher can access selected driver');
select extensions.ok(not public.can_access_driver('10000000-0000-0000-0000-000000000004'), 'dispatcher cannot access unselected driver');

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
select extensions.is(
  public.set_dispatcher_driver_access('10000000-0000-0000-0000-000000000002', null),
  0,
  'NULL driver list switches dispatcher to all drivers'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
select extensions.ok(public.can_access_driver('10000000-0000-0000-0000-000000000004'), 'all-drivers scope grants access to driver two');

insert into test_ids(load_id)
select public.create_load_draft(
  'LOAD-100', 'Broker One', 'Dry goods', 'Dry Van', 20000, 2400, 1000,
  '{"facilityName":"Pickup","addressLine":"1 Origin Rd","city":"Boise","region":"ID","requiresDocument":true}'::jsonb,
  '{"facilityName":"Delivery","addressLine":"2 Destination Ave","city":"Reno","region":"NV","requiresDocument":true}'::jsonb,
  null
)
on conflict do nothing;

-- The insert above adds a second row because the temp table has no key; keep
-- the generated id in the original row for simpler scalar subqueries.
update test_ids set load_id = (select load_id from test_ids where load_id is not null limit 1);
delete from test_ids a using test_ids b where a.ctid > b.ctid;

do $$ begin
  perform public.approve_load_draft((select load_id from test_ids));
end $$;

update test_ids
set offline_offer_id = (public.send_offer(
  load_id,
  '10000000-0000-0000-0000-000000000003',
  43.6150, -116.2023, 15, '[]'::jsonb
)).id;

select extensions.is(
  (select status::text from public.offers where id = (select offline_offer_id from test_ids)),
  'missed_offline',
  'offline driver offer is recorded as missed'
);
select extensions.is(
  (select status::text from public.loads where id = (select load_id from test_ids)),
  'ready_for_offer',
  'missed offline offer does not change load to offered'
);
select extensions.is(
  (select count(*) from public.notifications where entity_id = (select offline_offer_id from test_ids)),
  0::bigint,
  'offline offer creates no driver notification'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select extensions.is(
  (select count(*) from public.driver_offer_inbox where id = (select offline_offer_id from test_ids)),
  0::bigint,
  'driver cannot see a missed offline offer later'
);
do $$ begin perform public.upsert_driver_presence(43.6150, -116.2023, null, null, true); end $$;

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000004';
do $$ begin perform public.upsert_driver_presence(43.6200, -116.2100, null, null, true); end $$;

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
update test_ids set offer_one_id = (public.send_offer(
  load_id, '10000000-0000-0000-0000-000000000003', 43.6150, -116.2023, 15, '[]'::jsonb
)).id;
update test_ids set offer_two_id = (public.send_offer(
  load_id, '10000000-0000-0000-0000-000000000004', 43.6200, -116.2100, 20, '[]'::jsonb
)).id;

select extensions.is(
  (select count(*) from public.offers where load_id = (select load_id from test_ids) and status = 'pending'),
  2::bigint,
  'multiple online drivers can receive a pending offer'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select extensions.is(
  public.respond_offer(
    (select offer_one_id from test_ids),
    'accept',
    '30000000-0000-0000-0000-000000000001'
  )->>'status',
  'accepted',
  'first driver atomically accepts the load'
);
select extensions.ok(
  (select accepted_price_snapshot_id is not null from public.assignments where driver_id = '10000000-0000-0000-0000-000000000003' and status = 'active'),
  'assignment keeps the exact accepted price snapshot'
);
select extensions.is(
  public.respond_offer(
    (select offer_one_id from test_ids),
    'accept',
    '30000000-0000-0000-0000-000000000001'
  )->>'status',
  'accepted',
  'replaying the same operation is idempotent'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000004';
select extensions.throws_ok(
  format(
    $$select public.respond_offer('%s', 'accept', '30000000-0000-0000-0000-000000000002')$$,
    (select offer_two_id from test_ids)
  ),
  'P0001',
  'Offer is no longer available',
  'second driver cannot accept an already assigned load'
);
select extensions.ok(
  not public.can_access_load((select load_id from test_ids)),
  'superseded driver can no longer read the assigned load'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.update_load_terms((select load_id from test_ids), 2600, 1000, null, null, null, null, null);
end $$;
select extensions.ok(
  (select requires_reconfirmation from public.assignments where id = (select current_assignment_id from public.loads where id = (select load_id from test_ids))),
  'material term change requires driver reconfirmation'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select extensions.throws_ok(
  format(
    $$select public.transition_stop('%s', 'arrived', gen_random_uuid(), %s, now(), 43.6150, -116.2023)$$,
    (select id from public.load_stops where load_id = (select load_id from test_ids) and type = 'pickup'),
    (select version from public.loads where id = (select load_id from test_ids))
  ),
  'P0001',
  'Updated load terms must be confirmed first',
  'driver cannot advance a changed load before reconfirming'
);

do $$ begin perform public.confirm_updated_terms((select load_id from test_ids)); end $$;
select extensions.lives_ok(
  format(
    $$select public.transition_stop('%s', 'arrived', gen_random_uuid(), %s, now(), 43.6150, -116.2023)$$,
    (select id from public.load_stops where load_id = (select load_id from test_ids) and type = 'pickup'),
    (select version from public.loads where id = (select load_id from test_ids))
  ),
  'driver can continue after confirming updated terms'
);
select extensions.is(
  (select count(*) from public.location_snapshots where load_id = (select load_id from test_ids)),
  1::bigint,
  'driver event stores one location snapshot'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
select extensions.is(
  (select count(*) from public.loads where company_id = 'a0000000-0000-0000-0000-000000000002'),
  0::bigint,
  'dispatcher cannot read another company load'
);
select extensions.throws_ok(
  format($$update public.loads set status = 'completed' where id = '%s'$$, (select load_id from test_ids)),
  '42501',
  null,
  'authenticated client cannot update load status directly'
);

select * from extensions.finish();
rollback;
