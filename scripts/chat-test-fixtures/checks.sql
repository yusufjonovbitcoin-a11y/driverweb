-- For scripts/chat-test-fixtures/bootstrap.sql, never the linked/live database.
insert into public.chat_messages(company_id,conversation_id,sender_id,body,created_at)
select '00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000002','history '||i, now()-interval '1 day'+i*interval '1 second'
from generate_series(1,250) i;
update public.chat_messages set deleted_at=now() where body='history 200';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert((select sum(unread_count) from get_chat_unread_summary())=249,'aggregate unread covers all history');
select test_assert((select count(*) from get_chat_sync_page('00000000-0000-0000-0000-000000000010'))=100,'sync pagination is bounded');
select test_assert((select count(*) from get_chat_sync_page('00000000-0000-0000-0000-000000000010') where deleted_at is not null)=1,'sync includes tombstones');
select test_assert((select count(*) from search_chat_messages('00000000-0000-0000-0000-000000000010','history 10'))=1,'search finds an unloaded old message');
select test_assert(mark_chat_messages_read('00000000-0000-0000-0000-000000000010',array[(select id from chat_messages where body='history 1')])=1,'marks only visible IDs');
select test_assert((select sum(unread_count) from get_chat_unread_summary())=248,'unseen messages remain unread');
do $$begin
  perform mark_chat_messages_read('00000000-0000-0000-0000-000000000011','{}');
  raise exception 'Cross-tenant read unexpectedly allowed';
exception when raise_exception then if sqlerrm <> 'Chat access denied' then raise; end if; end$$;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select count(*) from get_chat_unread_summary())=0,'unread aggregation respects RLS');
do $$begin
  perform get_chat_sync_page('00000000-0000-0000-0000-000000000010');
  raise exception 'Cross-tenant sync unexpectedly allowed';
exception when raise_exception then if sqlerrm <> 'Chat access denied' then raise; end if; end$$;
reset role;
do $$begin
  insert into chat_messages(company_id,conversation_id,sender_id,body) values
    ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',repeat('x',4001));
  raise exception 'Long body unexpectedly allowed';
exception when string_data_right_truncation then raise notice 'PASS: body length limit'; end$$;
insert into chat_messages(company_id,conversation_id,sender_id,body)
select '00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','rate '||i from generate_series(1,60) i;
do $$begin
  insert into chat_messages(company_id,conversation_id,sender_id,body) values
    ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','too fast');
  raise exception 'Rate limit unexpectedly bypassed';
exception when raise_exception then if sqlerrm <> 'CHAT_RATE_LIMIT' then raise; end if; raise notice 'PASS: rate limit'; end$$;
insert into chat_messages(company_id,conversation_id,sender_id,body,client_id)
select company_id,conversation_id,sender_id,body,client_id from chat_messages where body='rate 1'
on conflict(sender_id,client_id) do nothing;
select test_assert((select count(*) from chat_messages where body='rate 1')=1,'retry allowed at rate limit without duplicates');
select test_assert(not has_function_privilege('anon','public.get_chat_unread_summary()','execute'),'anonymous cannot execute summary');
select test_assert(not has_function_privilege('authenticated','public.guard_chat_message_write()','execute'),'trigger is not a callable API');
