insert into auth.users(id) values('00000000-0000-0000-0000-000000009606'),('00000000-0000-0000-0000-000000009607');
insert into profiles(id,company_id,role,full_name,email) values
 ('00000000-0000-0000-0000-000000009606','00000000-0000-0000-0000-000000000020','company_admin','Synthetic A','a@audit.test'),
 ('00000000-0000-0000-0000-000000009607','00000000-0000-0000-0000-000000000021','company_admin','Synthetic B','b@audit.test');
insert into chat_conversations(id,company_id,dispatcher_id,driver_id) values
 ('00000000-0000-0000-0000-000000009610','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004');
insert into chat_messages(id,storage_path) values('00000000-0000-0000-0000-000000009699','synthetic');
insert into chat_reports(company_id,conversation_id,message_id,reporter_id,reported_user_id,reason,evidence)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009610','00000000-0000-0000-0000-000000009699','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','other','{}');
begin read only;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(get_chat_safety_state('00000000-0000-0000-0000-000000009610')->>'canSend'='true','STABLE safety state works READ ONLY');
select test_error($$select get_chat_safety_state('00000000-0000-0000-0000-000000000011')$$,'Chat access denied');
select test_error($$select list_chat_reports()$$,'Moderator permission required');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000009606';
select test_assert((select count(*)=1 from list_chat_reports()),'STABLE moderator queue works READ ONLY');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000009607';
select test_assert((select count(*)=0 from list_chat_reports()),'moderator queue remains tenant scoped');
set local "request.jwt.claim.sub"='';
select test_error($$select get_chat_safety_state('00000000-0000-0000-0000-000000009610')$$,'Active authentication required');
rollback;
begin read only; set local role authenticated; set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(get_driver_analytics(now()-interval '7 days',now()+interval '1 day') is not null,'legacy driver analytics is read-only safe'); rollback;
update profiles set status='suspended' where id='00000000-0000-0000-0000-000000000004';
begin read only;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error($$select get_chat_safety_state('00000000-0000-0000-0000-000000009610')$$,'Active authentication required');
rollback;

update profiles set status='active' where id='00000000-0000-0000-0000-000000000004';
