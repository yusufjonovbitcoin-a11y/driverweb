-- Future explicit deletes only; isolated synthetic data, never production.
reset role;
select test_assert((select body='history 200' from chat_messages where deleted_at is not null limit 1),
  'migration does not bulk-redact historical tombstones');
select test_assert((select not public and file_size_limit=52428800 from storage.buckets where id='chat-media'),
  'chat bucket stays private with a 50 MiB upload limit');
update chat_messages set created_at=now()-interval '2 minutes' where body like 'rate %';
create temporary table privacy_messages(label text primary key,id uuid,revision bigint);
grant all on privacy_messages to authenticated;
insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-media','00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/own/photo.jpg','00000000-0000-0000-0000-000000000001'),
 ('chat-media','00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/other/photo.jpg','00000000-0000-0000-0000-000000000002');
insert into media_assets(id,company_id,uploaded_by,scope,context_id,cloudinary_asset_id,public_id,resource_type) values
 ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','chat','00000000-0000-0000-0000-000000000010','fixture-asset-1','fixture/photo-1','image'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','chat','00000000-0000-0000-0000-000000000010','fixture-asset-2','fixture/photo-2','image');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert(not exists(select 1 from storage.objects where name like '%/own/photo.jpg'),
  'recipient cannot sign an uncommitted upload owned by the sender');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert(exists(select 1 from storage.objects where name like '%/own/photo.jpg'),
  'uploader can inspect its pending upload for idempotent retry');
do $$begin
  perform send_chat_message('00000000-0000-0000-0000-000000000010','image',media_storage_path=>
    '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/other/photo.jpg');
  raise exception 'Recipient-owned Storage attachment hijacked';
exception when raise_exception then if sqlerrm<>'Invalid media reference' then raise; end if; end$$;
do $$begin
  perform send_chat_message('00000000-0000-0000-0000-000000000010','image',media_storage_path=>'cloudinary:00000000-0000-0000-0000-000000000101');
  raise exception 'Recipient-owned Cloudinary attachment hijacked';
exception when raise_exception then if sqlerrm<>'Invalid media reference' then raise; end if; end$$;
do $$begin
  insert into storage.objects(bucket_id,name,owner_id) values('chat-media',
    '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/forged/photo.jpg','00000000-0000-0000-0000-000000000002');
  raise exception 'Forged upload owner allowed';
exception when insufficient_privilege then raise notice 'PASS: upload owner cannot be forged'; end$$;
insert into privacy_messages select 'storage',m.id,m.revision from send_chat_message(
  '00000000-0000-0000-0000-000000000010','image','private caption',
  '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/own/photo.jpg',
  'private-name.jpg','image/jpeg',100,500,null,'00000000-0000-0000-0000-000000000201') m;
select test_assert((send_chat_message('00000000-0000-0000-0000-000000000010','image',media_storage_path=>
  '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/own/photo.jpg',
  message_client_id=>'00000000-0000-0000-0000-000000000201')).id=(select id from privacy_messages where label='storage'),
  'identical retry returns original media message');
do $$begin
  perform send_chat_message('00000000-0000-0000-0000-000000000010','image',media_storage_path=>
    '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/own/photo.jpg');
  raise exception 'Live media reference reused';
exception when raise_exception then if sqlerrm<>'Media reference already attached' then raise; end if; end$$;
delete from storage.objects where name like '%/own/photo.jpg';
select test_assert(exists(select 1 from storage.objects where name like '%/own/photo.jpg'),
  'uploader cannot physically delete a live attachment outside the message delete RPC');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert(exists(select 1 from storage.objects where name like '%/own/photo.jpg'),
  'recipient can sign an attachment after message commit');
do $$begin
  perform delete_chat_message((select id from privacy_messages where label='storage'));
  raise exception 'Recipient deleted someone else message';
exception when raise_exception then if sqlerrm<>'Only the sender can delete this message' then raise; end if; end$$;
reset role;
select test_assert((select count(*) from notifications where chat_message_id=(select id from privacy_messages where label='storage'))=1,
  'send retries do not duplicate notifications');
insert into notifications(company_id,recipient_id,type,title,body,entity_type,entity_id) values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','chat_message','Old sender','unlinked legacy notification','chat_conversation','00000000-0000-0000-0000-000000000010');
insert into push_devices(id) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(300,303)n;
insert into push_deliveries(notification_id,device_id,company_id,recipient_id,platform,token_snapshot,status,locked_at,locked_by)
select n.id,d.id,n.company_id,n.recipient_id,'web','synthetic-token',
  case right(d.id::text,1) when '0' then 'pending' when '1' then 'processing' when '2' then 'failed' else 'sent' end,now(),'fixture-worker'
from notifications n cross join push_devices d where n.chat_message_id=(select id from privacy_messages where label='storage');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert(delete_chat_message((select id from privacy_messages where label='storage')) is null,
  'explicit sender deletion delegates durable cleanup to the server');
select test_assert((select deleted_at is not null and body is null and storage_path is null and file_name is null
  and mime_type is null and size_bytes is null and duration_ms is null and reply_to_id is null and revision=2
  from chat_messages where id=(select id from privacy_messages where label='storage')),
  'deleted message retains only a versioned content-free tombstone');
select delete_chat_message((select id from privacy_messages where label='storage'));
select test_assert((select revision=2 from chat_messages where id=(select id from privacy_messages where label='storage')),
  'delete retries do not advance revisions');
select test_assert((send_chat_message('00000000-0000-0000-0000-000000000010','image',media_storage_path=>
  '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/own/photo.jpg',
  message_client_id=>'00000000-0000-0000-0000-000000000201')).deleted_at is not null,
  'late send retry cannot resurrect a deleted message');
select test_assert(not exists(select 1 from storage.objects where name like '%/own/photo.jpg'),
  'even uploader cannot obtain a new signed URL after deletion');
do $$begin
  insert into storage.objects(bucket_id,name,owner_id) values('chat-media',
    '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/own/photo.jpg','00000000-0000-0000-0000-000000000001');
  raise exception 'Revoked path recreated';
exception when insufficient_privilege then raise notice 'PASS: revoked path cannot be recreated'; end$$;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert(not exists(select 1 from storage.objects where name like '%/own/photo.jpg'),
  'recipient loses new URL access after deletion');
select test_assert((select deleted_at is not null and body is null from get_chat_sync_page('00000000-0000-0000-0000-000000000010')
  where id=(select id from privacy_messages where label='storage')),'sync RPC returns sanitized tombstone');
reset role;
select test_assert((select count(*) from jobs where idempotency_key='chat-media-delete:'||(select id from privacy_messages where label='storage'))=1,
  'durable cleanup queued exactly once');
select test_assert((select payload->>'bucket'='chat-media' and payload->>'provider'='supabase_storage'
  from jobs where payload->>'messageId'=(select id::text from privacy_messages where label='storage')),'cleanup job identifies correct private bucket');
select test_assert((select body='' and title='' and type='chat_message_deleted' and read_at is not null from notifications
  where chat_message_id=(select id from privacy_messages where label='storage')),'linked notification copy is redacted');
select test_assert((select count(*) from push_deliveries where status='cancelled' and locked_at is null and locked_by is null)=3,
  'queued, failed and in-flight pushes are cancelled atomically');
select test_assert((select count(*) from push_deliveries where status='sent')=1,'sent push delivery history is preserved');
select test_assert(exists(select 1 from notifications where body='unlinked legacy notification'),
  'unlinked legacy notifications are not guessed or bulk-redacted');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
insert into privacy_messages select 'cloudinary',m.id,m.revision from send_chat_message('00000000-0000-0000-0000-000000000010','image',
  media_storage_path=>'cloudinary:00000000-0000-0000-0000-000000000100') m;
select delete_chat_message((select id from privacy_messages where label='cloudinary'));
select test_assert(not exists(select 1 from media_assets where id='00000000-0000-0000-0000-000000000100'),
  'deleted Cloudinary asset is immediately unavailable for new signing');
select test_assert(exists(select 1 from media_assets where id='00000000-0000-0000-0000-000000000101'),
  'unrelated existing Cloudinary media remains unchanged');
insert into privacy_messages select 'text',m.id,m.revision from send_chat_message('00000000-0000-0000-0000-000000000010','text','sensitive text') m;
select test_assert((edit_chat_message((select id from privacy_messages where label='text'),'corrected text')).revision=2,
  'edit returns monotonic revision');
reset role;
select test_assert((select body='corrected text' from notifications where chat_message_id=(select id from privacy_messages where label='text')),
  'edit keeps linked pending notification preview in sync');
set role authenticated;
select delete_chat_message((select id from privacy_messages where label='text'));
select test_assert((select body is null from chat_messages where id=(select id from privacy_messages where label='text')),
  'plain text delete removes original body');
reset role;
select test_assert((select payload->>'provider'='cloudinary' and payload->>'publicId'='fixture/photo-1'
  and payload->>'mediaAssetId'='00000000-0000-0000-0000-000000000100' from jobs where payload->>'messageId'=
  (select id::text from privacy_messages where label='cloudinary')),'Cloudinary cleanup has the exact registered resource identity');
select test_assert(not exists(select 1 from jobs where payload->>'messageId'=(select id::text from privacy_messages where label='text')),
  'plain text delete does not enqueue file deletion');

-- Simulate a failing durable queue without touching any existing user data.
insert into storage.objects(bucket_id,name,owner_id) values('chat-media',
 '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/rollback/photo.jpg','00000000-0000-0000-0000-000000000001');
create function test_reject_chat_cleanup() returns trigger language plpgsql as $$
begin if new.type='provider.media_delete' then raise exception 'Fixture cleanup queue unavailable'; end if; return new; end$$;
create trigger test_reject_chat_cleanup before insert on jobs for each row execute function test_reject_chat_cleanup();
set role authenticated;
insert into privacy_messages select 'rollback',m.id,m.revision from send_chat_message('00000000-0000-0000-0000-000000000010','image','keep until queued',
 media_storage_path=>'00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/rollback/photo.jpg') m;
do $$begin
 perform delete_chat_message((select id from privacy_messages where label='rollback'));
 raise exception 'Delete succeeded without durable cleanup';
exception when raise_exception then if sqlerrm<>'Fixture cleanup queue unavailable' then raise; end if; end$$;
select test_assert((select deleted_at is null and body='keep until queued' and revision=1 from chat_messages
 where id=(select id from privacy_messages where label='rollback')),'queue failure rolls back message deletion and revision');
select test_assert(exists(select 1 from storage.objects where name like '%/rollback/photo.jpg'),
 'queue failure rolls back signing revocation');
reset role;
select test_assert((select type='chat_message' and body<>'' from notifications where chat_message_id=(select id from privacy_messages where label='rollback')),
 'queue failure preserves original notification');
drop trigger test_reject_chat_cleanup on jobs;
drop function test_reject_chat_cleanup();
