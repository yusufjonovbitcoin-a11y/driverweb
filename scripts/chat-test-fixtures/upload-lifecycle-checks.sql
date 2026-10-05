reset role;
-- A historical object never enters the lifecycle, even if the web retries it.
insert into storage.objects(bucket_id,name,owner_id) values('chat-media',
 '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/old/file.pdf',
 '00000000-0000-0000-0000-000000000001');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert(register_chat_media_upload('00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/old/file.pdf') is null,
 'historical objects are not adopted for cleanup');
select register_chat_media_upload('00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/new/file.pdf');
select register_chat_media_upload('00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/committed/file.pdf');
select register_chat_media_upload('00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/document/file.pdf');
reset role;
select test_assert(not has_function_privilege('authenticated','public.queue_expired_chat_uploads(integer)','execute'),
 'clients cannot run orphan cleanup');
select test_assert(not has_function_privilege('authenticated','public.can_cleanup_chat_upload(uuid,uuid,text)','execute'),
 'clients cannot authorize orphan removal');
insert into storage.objects(bucket_id,name,owner_id)
 select 'chat-media',storage_path,uploaded_by::text from chat_pending_uploads;
-- Commit then lose the HTTP response: message/registration remain atomic.
insert into chat_messages(company_id,conversation_id,sender_id,kind,storage_path)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000001','file',
 '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/committed/file.pdf');
insert into document_versions(storage_path) values(
 '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/document/file.pdf');
select test_assert(queue_expired_chat_uploads(100)=0,'fresh uploads survive the full retry grace period');
update chat_pending_uploads set expires_at=now()-interval '1 second';
select test_assert(queue_expired_chat_uploads(100)=1,'only expired unreferenced new upload is queued');
select test_assert((select state='attached' from chat_pending_uploads where storage_path like '%/committed/file.pdf'),
 'ambiguous committed message cannot be swept');
select test_assert((select state='attached' from chat_pending_uploads where storage_path like '%/document/file.pdf'),
 'referenced driver document is retained');
select test_assert((select count(*)=1 from jobs where idempotency_key like 'chat-upload-delete:%'),
 'one orphan creates exactly one durable job');
select test_assert(queue_expired_chat_uploads(100)=0,'repeated cleanup never duplicates jobs');
select test_assert((select can_cleanup_chat_upload(id,company_id,storage_path) from chat_pending_uploads where storage_path like '%/new/file.pdf'),
 'worker authorizes exact revoked orphan identity');
select test_assert((select not can_cleanup_chat_upload(id,company_id,storage_path||'x') from chat_pending_uploads where storage_path like '%/new/file.pdf'),
 'worker refuses a different storage key');
select test_assert((select not can_cleanup_chat_upload(id,company_id,storage_path) from chat_pending_uploads where storage_path like '%/committed/file.pdf'),
 'worker never authorizes attached message');
set role authenticated;
do $$begin
  perform register_chat_media_upload('00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/new/file.pdf');
  raise exception 'Expired upload was reactivated';
exception when others then
  if sqlerrm='Expired upload was reactivated' then raise; end if;
end $$;
reset role;
do $$begin
  insert into chat_messages(company_id,conversation_id,sender_id,kind,storage_path)
    values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001','file',
    '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/new/file.pdf');
  raise exception 'Expired upload was attached';
exception when others then
  if sqlerrm='Expired upload was attached' then raise; end if;
end $$;
select test_assert((select count(*)=1 from storage.objects where name like '%/old/file.pdf'),
 'historical file remains untouched');
-- Physical removal is never performed by SQL; only checked Storage API jobs.
