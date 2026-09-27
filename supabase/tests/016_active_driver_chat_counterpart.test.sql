begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), now(), now()
from (values
  ('a1100000-0000-0000-0000-000000000001'::uuid, 'admin@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000002'::uuid, 'dispatcher@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000003'::uuid, 'old-dispatcher@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000004'::uuid, 'driver@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000005'::uuid, 'driver2@active-chat.test')
) as users(id, email);

insert into public.companies(id, name)
values ('a1200000-0000-0000-0000-000000000001', 'Active chat fixture');

insert into public.profiles(id, company_id, role, status, full_name, email) values
  ('a1100000-0000-0000-0000-000000000001', 'a1200000-0000-0000-0000-000000000001', 'company_admin', 'active', 'Current Admin', 'admin@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000002', 'a1200000-0000-0000-0000-000000000001', 'dispatcher', 'active', 'Scoped Dispatcher', 'dispatcher@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000003', 'a1200000-0000-0000-0000-000000000001', 'dispatcher', 'suspended', 'Old Dispatcher', 'old-dispatcher@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000004', 'a1200000-0000-0000-0000-000000000001', 'driver', 'active', 'Assigned Driver', 'driver@active-chat.test'),
  ('a1100000-0000-0000-0000-000000000005', 'a1200000-0000-0000-0000-000000000001', 'driver', 'active', 'Unassigned Driver', 'driver2@active-chat.test');

insert into public.driver_profiles(user_id, company_id) values
  ('a1100000-0000-0000-0000-000000000004', 'a1200000-0000-0000-0000-000000000001'),
  ('a1100000-0000-0000-0000-000000000005', 'a1200000-0000-0000-0000-000000000001');

insert into public.chat_conversations(id, company_id, dispatcher_id, driver_id, last_message_at) values
  (
    'a1300000-0000-0000-0000-000000000001',
    'a1200000-0000-0000-0000-000000000001',
    'a1100000-0000-0000-0000-000000000003',
    'a1100000-0000-0000-0000-000000000004',
    now()
  ),
  (
    'a1300000-0000-0000-0000-000000000002',
    'a1200000-0000-0000-0000-000000000001',
    'a1100000-0000-0000-0000-000000000002',
    'a1100000-0000-0000-0000-000000000004',
    now() - interval '1 day'
  ),
  (
    'a1300000-0000-0000-0000-000000000003',
    'a1200000-0000-0000-0000-000000000001',
    'a1100000-0000-0000-0000-000000000003',
    'a1100000-0000-0000-0000-000000000005',
    now()
  );

insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status, broker_rate, loaded_miles
) values (
  'a1400000-0000-0000-0000-000000000001',
  'a1200000-0000-0000-0000-000000000001',
  'a1100000-0000-0000-0000-000000000001',
  'ACTIVE-CHAT-1', 'assigned', 1800, 750
);

insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by
) values (
  'a1500000-0000-0000-0000-000000000001',
  'a1200000-0000-0000-0000-000000000001',
  'a1400000-0000-0000-0000-000000000001',
  'a1100000-0000-0000-0000-000000000004',
  'active',
  'a1100000-0000-0000-0000-000000000001'
);
update public.loads
set current_assignment_id = 'a1500000-0000-0000-0000-000000000001'
where id = 'a1400000-0000-0000-0000-000000000001';

insert into public.dispatcher_driver_access(dispatcher_id, driver_id, company_id)
values (
  'a1100000-0000-0000-0000-000000000002',
  'a1100000-0000-0000-0000-000000000005',
  'a1200000-0000-0000-0000-000000000001'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'a1100000-0000-0000-0000-000000000004';
create temporary table opened_chat_result(chat_id uuid) on commit drop;
insert into opened_chat_result select public.open_default_driver_chat();

select extensions.is(
  (select chat_id from opened_chat_result),
  (
    select id from public.chat_conversations
    where dispatcher_id = 'a1100000-0000-0000-0000-000000000001'
      and driver_id = 'a1100000-0000-0000-0000-000000000004'
  ),
  'current load owner replaces the most recent suspended dispatcher chat'
);

select extensions.is(
  public.get_chat_context((select chat_id from opened_chat_result))->>'otherUserName',
  'Current Admin',
  'driver chat context exposes the active load owner'
);

set local "request.jwt.claim.sub" = 'a1100000-0000-0000-0000-000000000005';
truncate opened_chat_result;
insert into opened_chat_result select public.open_default_driver_chat();
select extensions.is(
  public.get_chat_context((select chat_id from opened_chat_result))->>'otherUserName',
  'Scoped Dispatcher',
  'an unassigned driver prefers the explicitly scoped active dispatcher'
);

set local role postgres;
select extensions.is(
  (
    select count(*) from public.chat_conversations
    where driver_id in (
      'a1100000-0000-0000-0000-000000000004',
      'a1100000-0000-0000-0000-000000000005'
    )
      and dispatcher_id = 'a1100000-0000-0000-0000-000000000003'
  ),
  2::bigint,
  'historical conversations with the suspended dispatcher remain preserved'
);

select * from extensions.finish();
rollback;
