begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), now(), now()
from (values
  ('f1000000-0000-0000-0000-000000000001'::uuid, 'admin-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000002'::uuid, 'dispatcher-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000003'::uuid, 'driver-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000004'::uuid, 'active-driver-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000005'::uuid, 'admin-b@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000006'::uuid, 'driver-b@member-delete.test')
) as users(id, email);

insert into public.companies(id, name) values
  ('f2000000-0000-0000-0000-000000000001', 'Member Delete A'),
  ('f2000000-0000-0000-0000-000000000002', 'Member Delete B');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'company_admin', 'Admin A', 'admin-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'dispatcher', 'Dispatcher A', 'dispatcher-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'driver', 'Driver A', 'driver-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000001', 'driver', 'Active Driver A', 'active-driver-a@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000005', 'f2000000-0000-0000-0000-000000000002', 'company_admin', 'Admin B', 'admin-b@member-delete.test'),
  ('f1000000-0000-0000-0000-000000000006', 'f2000000-0000-0000-0000-000000000002', 'driver', 'Driver B', 'driver-b@member-delete.test');

insert into public.driver_profiles(user_id, company_id) values
  ('f1000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000006', 'f2000000-0000-0000-0000-000000000002');

insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values
  (
    'f3000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000002',
    'MEMBER-DELETE-ACTIVE', 'assigned', 1600, 700
  ),
  (
    'f3000000-0000-0000-0000-000000000002',
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000002',
    'MEMBER-DELETE-OFFERED', 'offered', 1800, 750
  );

insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by
) values (
  'f4000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000004',
  'active', 'f1000000-0000-0000-0000-000000000002'
);
update public.loads
set current_assignment_id = 'f4000000-0000-0000-0000-000000000001'
where id = 'f3000000-0000-0000-0000-000000000001';

insert into public.offers(
  id, company_id, load_id, driver_id, status, loaded_miles,
  effective_rpm, created_by
) values (
  'f5000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000003',
  'pending', 750, 2.4,
  'f1000000-0000-0000-0000-000000000002'
);

select extensions.is(
  (public.suspend_company_member_for_deletion(
    'f1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000003'
  )).status,
  'suspended'::public.account_status,
  'company admin can suspend a driver for account deletion'
);

select extensions.is(
  (select status from public.offers where id = 'f5000000-0000-0000-0000-000000000001'),
  'withdrawn'::public.offer_status,
  'removing a driver withdraws that driver pending offers'
);

select extensions.is(
  (select status from public.loads where id = 'f3000000-0000-0000-0000-000000000002'),
  'ready_for_offer'::public.load_status,
  'an offered load without another pending offer returns to ready'
);

select extensions.throws_ok(
  $$insert into public.offers(
    id, company_id, load_id, driver_id, status, loaded_miles,
    effective_rpm, created_by
  ) values (
    'f5000000-0000-0000-0000-000000000002',
    'f2000000-0000-0000-0000-000000000001',
    'f3000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000003',
    'pending', 750, 2.4,
    'f1000000-0000-0000-0000-000000000002'
  )$$,
  'P0001', 'Driver is not eligible',
  'a suspended driver cannot receive a new pending offer'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000003';
select extensions.throws_ok(
  $$select public.respond_offer(
    'f5000000-0000-0000-0000-000000000001',
    'accept',
    'f6000000-0000-0000-0000-000000000001'
  )$$,
  'P0001', 'Driver permission required',
  'a suspended driver cannot use an already-issued JWT to accept an offer'
);
reset role;

select extensions.is(
  (public.suspend_company_member_for_deletion(
    'f1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000002'
  )).status,
  'suspended'::public.account_status,
  'company admin can suspend a dispatcher for account deletion'
);

select extensions.is(
  (
    select count(*)
    from public.loads
    where company_id = 'f2000000-0000-0000-0000-000000000001'
      and status not in ('completed', 'cancelled')
      and owner_dispatcher_id = 'f1000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'open loads owned by a removed dispatcher transfer to the company admin'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000002';
select extensions.throws_ok(
  $$select public.send_offer(
    'f3000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000004'
  )$$,
  'P0001', 'Dispatcher permission required',
  'a suspended dispatcher cannot use an already-issued JWT to send an offer'
);
reset role;

select extensions.throws_ok(
  $$select public.suspend_company_member_for_deletion(
    'f1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000004'
  )$$,
  'P0001', 'Driver has an active load',
  'an actively assigned driver must be reassigned before deletion'
);

select extensions.throws_ok(
  $$select public.suspend_company_member_for_deletion(
    'f1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000006'
  )$$,
  'P0001', 'Company member not found',
  'company admin cannot remove a member from another tenant'
);

select extensions.throws_ok(
  $$select public.suspend_company_member_for_deletion(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000003'
  )$$,
  'P0001', 'Company admin permission required',
  'dispatcher cannot remove company members'
);

select extensions.throws_ok(
  $$select public.suspend_company_member_for_deletion(
    'f1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001'
  )$$,
  'P0001', 'Only drivers or dispatchers may be removed',
  'company admin cannot remove an administrator account'
);

select extensions.is(
  (select count(*) from public.audit_events where action = 'member.removed' and company_id = 'f2000000-0000-0000-0000-000000000001'),
  2::bigint,
  'each removed member produces one tenant audit event'
);

select * from extensions.finish();
rollback;
