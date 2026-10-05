-- Isolated local fixture only. No production credentials or user data.
reset role;
select test_assert((select min(revision)=1 and max(revision)=1 from chat_messages),'existing rows start at revision one');
update chat_messages set body='history 1 revised' where body='history 1';
select test_assert((select revision=2 from chat_messages where body='history 1 revised'),'content changes increment message revision');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select mark_chat_read('00000000-0000-0000-0000-000000000010');
select test_assert(get_unread_chat_count()=0,'legacy unread count is consistent after reads');
select test_assert(mark_chat_unread('00000000-0000-0000-0000-000000000010') is not null,'manual unread marks a conversation');
select test_assert((select count(*) from chat_messages where sender_id='00000000-0000-0000-0000-000000000002' and deleted_at is null and read_at is null)=0,'manual unread preserves historical read receipts');
select test_assert(get_unread_chat_count()=1,'manual unread contributes one reminder');
select test_assert((select sum(unread_count) from get_chat_unread_summary())=get_unread_chat_count(),'summary and legacy count agree');
select test_assert(clear_chat_unread('00000000-0000-0000-0000-000000000010'),'explicit reopen clears own reminder');
select test_assert(get_unread_chat_count()=0,'clearing reminder leaves acknowledged reads intact');
select test_assert((select count(*) from chat_read_preferences where user_id=auth.uid() and marked_unread_at is null)=1,
  'clearing reminder uses an RLS-filtered update instead of a Realtime delete');
do $$begin
  perform mark_chat_unread('00000000-0000-0000-0000-000000000011');
  raise exception 'Unauthorized manual unread allowed';
exception when raise_exception then if sqlerrm<>'Chat access denied' then raise; end if; end$$;
select mark_chat_unread('00000000-0000-0000-0000-000000000010');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert((select count(*) from chat_read_preferences)=0,'manual unread state is private to its user');
do $$begin
  insert into chat_read_preferences(conversation_id,user_id) values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
  raise exception 'Direct reminder write allowed';
exception when insufficient_privilege then raise notice 'PASS: preferences cannot be mutated directly'; end$$;
reset role;
update profiles set status='suspended' where id='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$begin perform get_unread_chat_count(); raise exception 'Suspended count allowed';
exception when raise_exception then if sqlerrm<>'Active authentication required' then raise; end if; end$$;
reset role;
update profiles set status='active' where id='00000000-0000-0000-0000-000000000002';
insert into chat_conversations(id,company_id,dispatcher_id,driver_id) values
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005');
create temporary table call_test_ids(id uuid);
grant all on call_test_ids to authenticated;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
insert into call_test_ids select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id;
do $$begin perform start_chat_call('00000000-0000-0000-0000-000000000012','audio'); raise exception 'Cross-chat double booking allowed';
exception when raise_exception then if sqlerrm<>'CHAT_USER_BUSY' then raise; end if; raise notice 'PASS: participant-wide busy state'; end$$;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert((select count(*) from get_incoming_chat_calls())=1,'incoming recovery returns recipient current ringing call');
do $$begin perform publish_chat_signal((select id from call_test_ids),'ice',jsonb_build_object('candidate',repeat('x',8200))); raise exception 'Oversized signal allowed';
exception when raise_exception then if sqlerrm<>'CHAT_SIGNAL_INVALID' then raise; end if; raise notice 'PASS: signal payload bound'; end$$;
do $$declare n integer; begin for n in 1..120 loop perform publish_chat_signal((select id from call_test_ids),'ice',jsonb_build_object('candidate',n)); end loop; end$$;
do $$begin perform publish_chat_signal((select id from call_test_ids),'ice','{}'); raise exception 'Signal rate limit bypassed';
exception when raise_exception then if sqlerrm<>'CHAT_SIGNAL_RATE_LIMIT' then raise; end if; raise notice 'PASS: signal rate limit'; end$$;
reset role;
update chat_calls set started_at=now()-interval '2 minutes' where id=(select id from call_test_ids);
insert into chat_calls(company_id,conversation_id,initiator_id,recipient_id,kind,started_at)
values('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','audio',now()-interval '2 minutes');
set role authenticated;
do $$begin perform heartbeat_chat_call((select id from call_test_ids)); raise exception 'Stale call revived';
exception when raise_exception then if sqlerrm<>'Active call not found' then raise; end if; end$$;
select test_assert(recover_stale_chat_calls()=1,'actor recovery expires stale own call');
select test_assert((select count(*) from get_incoming_chat_calls())=0,'expired call no longer rings');
select test_assert(not has_function_privilege('authenticated','public.cleanup_stale_chat_calls(integer)','execute'),'global recovery is worker only');
select test_assert(not has_function_privilege('authenticated','public.expire_stale_chat_calls(uuid,uuid,integer)','execute'),'internal expiry helper is not exposed');
reset role;
select test_assert((select count(*) from chat_calls where company_id='00000000-0000-0000-0000-000000000021' and status='ringing')=1,'actor recovery does not alter another tenant');
select test_assert((select count(*) from chat_call_signals)=0,'stale recovery removes ephemeral signaling');
set role service_role;
select test_assert(cleanup_stale_chat_calls(100)=1,'worker recovery cleans remaining abandoned call');
reset role;
select test_assert(not has_function_privilege('anon','public.clear_chat_unread(uuid)','execute'),'anonymous cannot clear reminders');
select test_assert(not has_function_privilege('anon','public.get_incoming_chat_calls()','execute'),'anonymous cannot recover calls');

-- One surviving browser must not keep the absent participant busy forever.
truncate call_test_ids;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
insert into call_test_ids select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select respond_chat_call((select id from call_test_ids),'accepted');
reset role;
update chat_calls set initiator_heartbeat_at=now()-interval '30 seconds',recipient_heartbeat_at=now()-interval '20 seconds'
  where id=(select id from call_test_ids);
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select heartbeat_chat_call((select id from call_test_ids));
reset role;
select test_assert((select initiator_heartbeat_at>now()-interval '5 seconds' and recipient_heartbeat_at<now()-interval '15 seconds'
 from chat_calls where id=(select id from call_test_ids)),'heartbeat only refreshes its own participant');
update chat_calls set recipient_heartbeat_at=now()-interval '80 seconds',last_heartbeat_at=now()
 where id=(select id from call_test_ids);
set role authenticated;
do $$begin perform heartbeat_chat_call((select id from call_test_ids)); raise exception 'Absent peer revived by other participant';
exception when raise_exception then if sqlerrm<>'Active call not found' then raise; end if; end$$;
select test_assert(recover_stale_chat_calls()=1,'peer heartbeat expiry ends accepted call despite fresh shared heartbeat');
reset role;
select test_assert((select status='ended' from chat_calls where id=(select id from call_test_ids)),'peer heartbeat loss releases busy state');
