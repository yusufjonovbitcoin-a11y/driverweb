begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), now(), now()
from (values
  ('91000000-0000-0000-0000-000000000001'::uuid, 'chat-admin@audit.test'),
  ('91000000-0000-0000-0000-000000000002'::uuid, 'chat-driver@audit.test'),
  ('91000000-0000-0000-0000-000000000003'::uuid, 'chat-driver2@audit.test')
) as users(id, email);
insert into public.companies(id, name) values ('92000000-0000-0000-0000-000000000001', 'Chat audit fixture');
insert into public.profiles(id, company_id, role, full_name, email) values
  ('91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'company_admin', 'Admin', 'chat-admin@audit.test'),
  ('91000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', 'driver', 'Driver', 'chat-driver@audit.test'),
  ('91000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', 'driver', 'Driver 2', 'chat-driver2@audit.test');
insert into public.chat_conversations(id, company_id, dispatcher_id, driver_id) values
  ('93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002'),
  ('93000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003');
create temporary table chat_audit_ids(message_id uuid, call_id uuid);
grant all on chat_audit_ids to authenticated;
set local role authenticated;
set local "request.jwt.claim.sub" = '91000000-0000-0000-0000-000000000001';
insert into chat_audit_ids(message_id)
select (public.send_chat_message('93000000-0000-0000-0000-000000000001', 'text', 'Hello', message_client_id => '94000000-0000-0000-0000-000000000001')).id;
select extensions.is(
  (public.send_chat_message('93000000-0000-0000-0000-000000000001', 'text', 'Hello', message_client_id => '94000000-0000-0000-0000-000000000001')).id,
  (select message_id from chat_audit_ids), 'retry returns the original message');
select extensions.is((select count(*) from public.chat_messages where conversation_id = '93000000-0000-0000-0000-000000000001'), 1::bigint, 'retry does not insert a second message');
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000002', 'text', 'Wrong chat', message_client_id => '94000000-0000-0000-0000-000000000001')$$, 'P0001', 'Message client ID belongs to another conversation', 'client ID cannot be reused in another chat');
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000002', 'text', 'Bad reply', reply_to_message_id => (select message_id from chat_audit_ids))$$, 'P0001', 'Reply message not found in this conversation', 'replies cannot point into another conversation');
select extensions.lives_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000001', 'text', 'Good reply', reply_to_message_id => (select message_id from chat_audit_ids))$$, 'same conversation reply is accepted');
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000001', 'system', 'Forged system message')$$, 'P0001', 'Unsupported message kind', 'client cannot forge system messages');
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000001', 'call', 'Forged call log')$$, 'P0001', 'Unsupported message kind', 'client cannot forge call logs');
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000001', 'text', 'Hello', message_client_id => null)$$, 'P0001', 'Message client ID is required', 'null idempotency keys fail clearly');
update chat_audit_ids set call_id = (public.start_chat_call('93000000-0000-0000-0000-000000000001', 'video')).id;
select extensions.lives_ok($$select public.publish_chat_signal((select call_id from chat_audit_ids), 'offer', '{"sdp":"test"}')$$, 'active participant can publish signaling');

reset role;
select extensions.is((select count(*) from public.notifications where company_id = '92000000-0000-0000-0000-000000000001' and type = 'chat_message'), 2::bigint, 'only first sends create notifications, retries do not');
update public.profiles set status = 'suspended' where id = '91000000-0000-0000-0000-000000000001';
set local role authenticated;
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000001', 'text', 'Suspended')$$, 'P0001', 'Active authentication required', 'suspended profile cannot send');
select extensions.throws_ok($$select public.get_chat_messages_page('93000000-0000-0000-0000-000000000001')$$, 'P0001', 'Active authentication required', 'suspended profile cannot read message history via RPC');
select extensions.throws_ok($$select public.get_chat_context('93000000-0000-0000-0000-000000000001')$$, 'P0001', 'Active authentication required', 'suspended profile cannot read chat context');
select extensions.throws_ok($$select public.start_chat_call('93000000-0000-0000-0000-000000000002', 'audio')$$, 'P0001', 'Active authentication required', 'suspended profile cannot start calls');
select extensions.throws_ok($$select public.respond_chat_call((select call_id from chat_audit_ids), 'ended')$$, 'P0001', 'Active authentication required', 'suspended profile cannot change calls');
select extensions.throws_ok($$select public.heartbeat_chat_call((select call_id from chat_audit_ids))$$, 'P0001', 'Active authentication required', 'suspended profile cannot extend call leases');
select extensions.throws_ok($$select public.publish_chat_signal((select call_id from chat_audit_ids), 'ice', '{}')$$, 'P0001', 'Active authentication required', 'suspended profile cannot publish signals');
select extensions.throws_ok($$select public.delete_chat_message((select message_id from chat_audit_ids))$$, 'P0001', 'Active authentication required', 'suspended profile cannot delete messages');
select extensions.is((select count(*) from public.chat_calls where company_id = '92000000-0000-0000-0000-000000000001'), 0::bigint, 'suspended profile cannot read call rows');
select extensions.is((select count(*) from public.chat_call_signals where company_id = '92000000-0000-0000-0000-000000000001'), 0::bigint, 'suspended profile cannot read ICE or SDP');

set local "request.jwt.claim.sub" = '91000000-0000-0000-0000-000000000003';
select extensions.throws_ok($$select public.send_chat_message('93000000-0000-0000-0000-000000000001', 'text', 'Intruder')$$, 'P0001', 'Chat access denied', 'non-participant cannot send to another driver chat');
select extensions.is((select count(*) from public.chat_call_signals), 0::bigint, 'non-participant cannot read signals');
select * from extensions.finish();
rollback;
