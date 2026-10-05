insert into companies(id,name) values
 ('00000000-0000-0000-0000-000000000020','Test company'),('00000000-0000-0000-0000-000000000021','Other company');
insert into auth.users(id) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,7)n;
insert into profiles(id,company_id,role,status,full_name,email) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','company_admin','active','Admin','a@test.invalid'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','dispatcher','active','Dispatch','b@test.invalid'),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020','driver','active','Old driver','c@test.invalid'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000020','driver','active','New driver','d@test.invalid'),
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000021','company_admin','active','Foreign','e@test.invalid'),
 ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000020','company_admin','suspended','Suspended','f@test.invalid'),
 ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000020','dispatcher','invited','Invited','g@test.invalid');
select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid) from generate_series(30,34)n;
grant select on all tables in schema public to authenticated;
alter table loads enable row level security;
create policy loads_read on loads for select to authenticated using(can_access_load(id));
select test_assert(not has_function_privilege('anon','trash_load(uuid,bigint)','execute')
 and not has_function_privilege('anon','restore_trashed_load(uuid,bigint,uuid)','execute')
 and not has_function_privilege('anon','permanently_delete_trashed_load(uuid,bigint)','execute'),'anonymous RPC denied');
select test_assert(not has_function_privilege('authenticated','delete_unassigned_load(uuid)','execute'),'legacy destructive command revoked');
select test_assert(not has_table_privilege('authenticated','loads','update') and not has_table_privilege('authenticated','loads','delete'),'no direct load mutations');

set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_PERMISSION');
select test_error($$select restore_trashed_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_PERMISSION');
select test_error($$select permanently_delete_trashed_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_PERMISSION');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_NOT_FOUND');
select test_error($$select restore_trashed_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_NOT_FOUND');
select test_error($$select permanently_delete_trashed_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_NOT_FOUND');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_PERMISSION');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000007';
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_TRASH_PERMISSION');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',null)$$,'LOAD_TRASH_CONFLICT');
select test_error($$select permanently_delete_trashed_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_NOT_TRASHED');
select test_error($$select restore_trashed_load('00000000-0000-0000-0000-000000000030',1)$$,'LOAD_NOT_TRASHED');
select (assign_load_directly('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000003')).id as old_assignment \gset
reset role;
insert into load_stops(id,company_id,load_id,type,sequence,address_line,city,region,requires_document)
values('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030','pickup',1,'Test','City','ST',true);
do $$ declare d uuid; v uuid; begin
 for n in 1..10 loop
  insert into documents(company_id,load_id,stop_id,document_type,created_by)
  values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000040','bol','00000000-0000-0000-0000-000000000003') returning id into d;
  insert into document_versions(company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by,uploaded_at)
  values('00000000-0000-0000-0000-000000000020',d,1,'bol.pdf','application/pdf','retained/'||d,'00000000-0000-0000-0000-000000000003',now()-interval '1 day') returning id into v;
  update documents set current_version_id=v where id=d;
 end loop;
end $$;
update load_stops set status='done' where id='00000000-0000-0000-0000-000000000040';
update assignments set driver_stage='delivered' where id=:'old_assignment';
update loads set status='delivered' where id='00000000-0000-0000-0000-000000000030';
insert into driver_tracking_sessions(assignment_id,company_id,driver_id,load_id,started_at)
 values(:'old_assignment','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030',now()-interval '1 day');
insert into driver_location_points(id,assignment_id,company_id,driver_id,load_id,latitude,longitude,accuracy_m,captured_at)
 values(gen_random_uuid(),:'old_assignment','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030',1,1,10,now());
insert into offers(company_id,load_id,driver_id,status,loaded_miles,created_by) values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000004','pending',500,'00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000003','missed_offline',500,'00000000-0000-0000-0000-000000000001');
insert into push_devices values('00000000-0000-0000-0000-000000000050');
insert into push_deliveries(notification_id,device_id,company_id,recipient_id,platform,token_snapshot,status)
 select id,'00000000-0000-0000-0000-000000000050',company_id,recipient_id,'ios','fake-test-token','failed' from notifications where entity_id='00000000-0000-0000-0000-000000000030';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select begin_document_upload('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000040','bol','eleventh.pdf','application/pdf')$$,'maximum of 10');
select begin_document_upload('00000000-0000-0000-0000-000000000030',null,'photo','late.png','image/png')->>'versionId' as old_upload \gset
reset role;
insert into storage.objects select 'load-documents',storage_path from document_versions where id=:'old_upload';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert((trash_load('00000000-0000-0000-0000-000000000030',2)).version=3,'dispatcher can trash assigned delivered load');
select test_assert((select v.trashed_at is not null and l.current_assignment_id is null and v.status='cancelled'
 and v.trash_previous_driver_id='00000000-0000-0000-0000-000000000003' and v.trash_previous_status='delivered' from load_overview v join loads l using(id)
 where id='00000000-0000-0000-0000-000000000030'),'trash metadata exposed');
select test_assert((select status='cancelled' and ended_at is not null from assignments where id=:'old_assignment'),'driver released');
select test_assert((select ended_at is not null from driver_tracking_sessions where assignment_id=:'old_assignment'),'tracking session ended');
select test_assert((select count(*) from driver_location_points)=1,'GPS history retained');
select test_assert(not exists(select 1 from offers where status in('pending','missed_offline')),'outstanding offers withdrawn');
reset role;
select test_assert((select bool_and(status='cancelled') from push_deliveries),'retrying stale pushes cancelled');
set role authenticated;
select test_assert((select count(*) from document_versions)=11,'all document versions retained');
select test_assert(not can_upload_load_document('00000000-0000-0000-0000-000000000030'),'staff storage uploads blocked in trash');
begin read only;
select test_assert((get_company_trip_analytics()->>'total')::int=4,'company analytics omit trash in read-only transaction');
commit;
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',2)$$,'LOAD_TRASH_CONFLICT');
select test_error($$select trash_load('00000000-0000-0000-0000-000000000030',3)$$,'LOAD_ALREADY_TRASHED');
select test_error($$select begin_document_upload('00000000-0000-0000-0000-000000000030',null,'photo','blocked.png','image/png')$$,'LOAD_TRASHED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(not can_access_load('00000000-0000-0000-0000-000000000030') and not exists(select 1 from loads where id='00000000-0000-0000-0000-000000000030'),'former driver loses load read access');
select test_assert((get_driver_analytics(null,null)->>'activeCount')::int=0,'driver analytics omit trash');
select test_error(format('select complete_document_upload(%L)',:'old_upload'),'LOAD_TRASHED');
reset role;
select test_error($$update loads set broker_rate=22 where id='00000000-0000-0000-0000-000000000030'$$,'LOAD_TRASHED');
select test_error($$update load_stops set status='skipped' where id='00000000-0000-0000-0000-000000000040'$$,'LOAD_TRASHED');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select restore_trashed_load('00000000-0000-0000-0000-000000000030',3,'00000000-0000-0000-0000-000000000005')$$,'Driver is not eligible');
select test_assert((select trashed_at is not null and version=3 from loads where id='00000000-0000-0000-0000-000000000030'),'invalid restore rolls back');
select test_assert((restore_trashed_load('00000000-0000-0000-0000-000000000030',3,'00000000-0000-0000-0000-000000000004')).version=5,'restore and reassignment atomic');
select test_assert((select a.id<>:'old_assignment' and a.driver_id='00000000-0000-0000-0000-000000000004' and a.driver_stage='accepted' and a.status='active'
 from loads l join assignments a on a.id=l.current_assignment_id where l.id='00000000-0000-0000-0000-000000000030'),'new driver receives fresh accepted assignment');
select test_assert((select status='pending' from load_stops where id='00000000-0000-0000-0000-000000000040') and not stop_has_required_document('00000000-0000-0000-0000-000000000040'),'restart resets progress and old BOL does not prove new trip');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error(format('select complete_document_upload(%L)',:'old_upload'),'LOAD_DOCUMENT_STALE');
select test_error(format('select complete_document_upload(%L)',(select min(id::text) from document_versions where storage_path like 'retained/%')),'LOAD_DOCUMENT_STALE');
select test_error(format('select bind_document_version_media(%L,%L)',:'old_upload','cloudinary:old'),'LOAD_DOCUMENT_STALE');
select test_assert(not can_access_load_media_context(:'old_upload'),'old unfinished upload cannot get new media authorization');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select begin_document_upload('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000040','bol','new-trip.pdf','application/pdf')->>'versionId' as new_upload \gset
select test_assert(:'new_upload' is not null,'ten retained BOL files do not exhaust new trip allowance');
reset role;
insert into storage.objects select 'load-documents',storage_path from document_versions where id=:'new_upload';
set role authenticated;
select complete_document_upload(:'new_upload');
reset role;
select test_assert(stop_has_required_document('00000000-0000-0000-0000-000000000040'),'fresh BOL satisfies restarted evidence');
update load_stops set status='done' where id='00000000-0000-0000-0000-000000000040';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select trash_load('00000000-0000-0000-0000-000000000030',5);
select test_assert((restore_trashed_load('00000000-0000-0000-0000-000000000030',6)).status='ready_for_offer','restore without driver goes to active unassigned list');
select test_assert((select current_assignment_id is null from loads where id='00000000-0000-0000-0000-000000000030'),'unassigned restore has no stale assignment');
select trash_load('00000000-0000-0000-0000-000000000030',7);
select restore_trashed_load('00000000-0000-0000-0000-000000000030',8,'00000000-0000-0000-0000-000000000004');
select test_assert((select count(*) from assignments where load_id='00000000-0000-0000-0000-000000000030')=3,'same driver restore creates another assignment, never reopens old one');
reset role;
update loads set driver_brief='{"reviewedAt":null,"blockingFields":["origin"]}' where id='00000000-0000-0000-0000-000000000033';
set role authenticated;
select trash_load('00000000-0000-0000-0000-000000000033',1);
select test_error($$select restore_trashed_load('00000000-0000-0000-0000-000000000033',2,'00000000-0000-0000-0000-000000000004')$$,'Document review required');
select test_assert((select trashed_at is not null and version=2 from loads where id='00000000-0000-0000-0000-000000000033'),'review failure preserves complete trash state');

select begin_document_upload('00000000-0000-0000-0000-000000000034',null,'photo','expired.png','image/png')->>'versionId' as expired_upload \gset
reset role;
update document_versions set upload_expires_at=now()-interval '1 second' where id=:'expired_upload';
set role authenticated;
select trash_load('00000000-0000-0000-0000-000000000034',1);
reset role;
select test_assert(cleanup_expired_document_uploads()=1,'expired unfinished uploads still clean up in trash');
select test_assert(not exists(select 1 from documents where load_id='00000000-0000-0000-0000-000000000034'),'expired empty document placeholders clean up');

-- Actual finalized evidence/FK cascade, with a source asset also used by chat.
reset role;
insert into broker_messages(id,company_id,provider_message_id,from_email,received_at)
 values('00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000020','source-message','broker@test.invalid',now());
insert into broker_attachments(id,company_id,message_id,file_name,mime_type,storage_path,checksum_sha256)
 values('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000080','original.pdf','application/pdf','shared-source.pdf','checksum');
update loads set broker_message_id='00000000-0000-0000-0000-000000000080' where id='00000000-0000-0000-0000-000000000032';
insert into load_price_snapshots(company_id,load_id,broker_rate,loaded_miles,loaded_rpm,source_attachment_id,created_by)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000032',1000,500,2,'00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000001');
select assign_load_directly('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000003');
insert into load_stops(id,company_id,load_id,type,sequence,address_line,city,region,requires_document)
 values('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000032','delivery',1,'Test','City','ST',true);
insert into documents(id,company_id,load_id,stop_id,document_type,created_by)
 values('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000042','pod','00000000-0000-0000-0000-000000000001');
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
 values('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000060',1,'original.pdf','application/pdf','shared-source.pdf','00000000-0000-0000-0000-000000000001');
update documents set current_version_id='00000000-0000-0000-0000-000000000061' where id='00000000-0000-0000-0000-000000000060';
update load_stops set status='done' where id='00000000-0000-0000-0000-000000000042';
update loads set status='completed' where id='00000000-0000-0000-0000-000000000032';
update assignments set status='completed',ended_at=now() where load_id='00000000-0000-0000-0000-000000000032';
insert into load_accounting(load_id,company_id,updated_by,driver_pay)
 values('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',400);
select test_error($$delete from documents where id='00000000-0000-0000-0000-000000000060'$$,'Required BOL/POD cannot be deleted');
insert into document_checks(company_id,document_version_id) values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000061');
insert into manual_load_imports(company_id,created_by,checksum_sha256,source_file_name,mime_type,size_bytes,storage_path,load_id)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','checksum','original.pdf','application/pdf',1,'shared-source.pdf','00000000-0000-0000-0000-000000000032');
insert into media_assets(id,company_id,scope,context_id) values('00000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000020','load_document','00000000-0000-0000-0000-000000000061');
insert into chat_messages values('00000000-0000-0000-0000-000000000063','shared-source.pdf');
insert into jobs(company_id,type,payload,idempotency_key) values('00000000-0000-0000-0000-000000000020','document.ai_check','{"documentVersionId":"00000000-0000-0000-0000-000000000061"}','test-check');
set role authenticated;
select trash_load('00000000-0000-0000-0000-000000000032',2);
select test_error($$select permanently_delete_trashed_load('00000000-0000-0000-0000-000000000032',2)$$,'LOAD_TRASH_CONFLICT');
select permanently_delete_trashed_load('00000000-0000-0000-0000-000000000032',3);
reset role;
select test_assert(not exists(select 1 from loads where id='00000000-0000-0000-0000-000000000032')
 and not exists(select 1 from documents where id='00000000-0000-0000-0000-000000000060')
 and not exists(select 1 from document_versions where id='00000000-0000-0000-0000-000000000061')
 and not exists(select 1 from document_checks where document_version_id='00000000-0000-0000-0000-000000000061'),'permanent delete cascades finalized evidence and checks');
select test_assert((select count(*) from manual_load_imports where load_id is null)=1 and (select count(*) from media_assets)=1
 and (select count(*) from chat_messages)=1 and (select count(*) from broker_attachments)=1
 and (select count(*) from broker_messages)=1,'shared media, chat and original import/email retained');
select test_assert((select status='dead_letter' from jobs where idempotency_key='test-check')
 and not exists(select 1 from jobs where type='provider.media_delete' and payload->>'documentVersionId'='00000000-0000-0000-0000-000000000061'),'stale AI job retired without deleting source blobs');
select test_assert(not exists(select 1 from assignments where load_id='00000000-0000-0000-0000-000000000032')
 and not exists(select 1 from load_price_snapshots where load_id='00000000-0000-0000-0000-000000000032')
 and not exists(select 1 from load_accounting where load_id='00000000-0000-0000-0000-000000000032')
 and not exists(select 1 from notifications where entity_id='00000000-0000-0000-0000-000000000032'),'load-owned assignments/prices/accounting/notifications removed');
select test_assert((select metadata->>'source_media_preserved'='true' from audit_events where action='load.permanently_deleted')
 and exists(select 1 from audit_events where action='load.restored' and jsonb_array_length(metadata->'previous_stops')>0),'audit retains trash/delete events and prior stop state');
