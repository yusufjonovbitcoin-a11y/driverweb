select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid) from generate_series(9000,9003)n;
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,requires_document)
select '00000000-0000-0000-0000-000000000020',l.id,
  case when n=1 then 'pickup'::stop_type else 'delivery'::stop_type end,n,'100 Main St','City','NY',true
from loads l cross join generate_series(1,2)n where l.id between
 '00000000-0000-0000-0000-000000009000' and '00000000-0000-0000-0000-000000009003';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Driver',null,null);
select assign_load_directly('00000000-0000-0000-0000-000000009000','00000000-0000-0000-0000-000000000003');
select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'original.pdf','application/pdf',123,'00000000-0000-0000-0000-000000009900') as first_upload \gset
select test_assert(begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'original.pdf','application/pdf',123,'00000000-0000-0000-0000-000000009900')=:'first_upload'::jsonb,'upload preparation is idempotent');
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'different.pdf','application/pdf',123,'00000000-0000-0000-0000-000000009900')$$,'STAFF_DOCUMENT_CONFLICT');
select test_assert((select current_version_id is null from documents where id=(:'first_upload'::jsonb->>'documentId')::uuid),'preparation does not invent a current file');
select test_error(format('select complete_staff_document_upload(%L,%L)',:'first_upload'::jsonb->>'versionId','cloudinary:00000000-0000-0000-0000-000000009800'),'STAFF_DOCUMENT_MEDIA_INVALID');
select test_error(format('select bind_document_version_media(%L,%L)',:'first_upload'::jsonb->>'versionId','cloudinary:00000000-0000-0000-0000-000000009800'),'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
select test_error(format('select complete_document_upload(%L)',:'first_upload'::jsonb->>'versionId'),'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
reset role;
insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
values('00000000-0000-0000-0000-000000009800','00000000-0000-0000-0000-000000000020','load_document',(:'first_upload'::jsonb->>'versionId')::uuid,
 '00000000-0000-0000-0000-000000000001','application/pdf',123);
select md5(row(broker_rate,loaded_miles,driver_brief)::text) as original_load_facts from loads where id='00000000-0000-0000-0000-000000009000' \gset
select version as original_load_version from loads where id='00000000-0000-0000-0000-000000009000' \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select complete_staff_document_upload((:'first_upload'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000009800');
select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,(:'first_upload'::jsonb->>'documentId')::uuid,
 (:'first_upload'::jsonb->>'versionId')::uuid,'replacement.pdf','application/pdf',456,'00000000-0000-0000-0000-000000009901') as replacement \gset
select test_assert((select current_version_id=(:'first_upload'::jsonb->>'versionId')::uuid from documents where id=(:'first_upload'::jsonb->>'documentId')::uuid),'old file stays current throughout failed/incomplete upload');
reset role;
select claim_document_check('staff-test-original-lease',(:'first_upload'::jsonb->>'versionId')::uuid) as old_lease \gset
insert into warnings(company_id,load_id,document_check_id,code,params)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009000',(:'old_lease'::jsonb->>'checkId')::uuid,'old_warning','{}');
insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
values('00000000-0000-0000-0000-000000009801','00000000-0000-0000-0000-000000000020','load_document',(:'replacement'::jsonb->>'versionId')::uuid,
 '00000000-0000-0000-0000-000000000001','application/pdf',456);
set role authenticated;
select complete_staff_document_upload((:'replacement'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000009801');
select test_error(format('select complete_staff_document_upload(%L,%L)',:'first_upload'::jsonb->>'versionId','cloudinary:00000000-0000-0000-0000-000000009800'),'STAFF_DOCUMENT_CONFLICT');
select test_error(format('select remove_staff_load_document(%L,%L,%L,gen_random_uuid())','00000000-0000-0000-0000-000000009000',:'first_upload'::jsonb->>'documentId',:'first_upload'::jsonb->>'versionId'),'STAFF_DOCUMENT_CONFLICT');
reset role;
select test_assert(not finish_document_check((:'old_lease'::jsonb->>'jobId')::uuid,'staff-test-original-lease',(:'old_lease'::jsonb->>'checkId')::uuid,
 'warning',0.8,'test','{}','[{"code":"late_warning","params":{}}]'),'late worker cannot reactivate warnings from replaced version');
select test_assert(not exists(select 1 from warnings where document_check_id=(:'old_lease'::jsonb->>'checkId')::uuid and is_active),'old warnings are inactive');
select test_assert((select count(*)=2 from document_versions where document_id=(:'first_upload'::jsonb->>'documentId')::uuid),'replacement retains both immutable versions');
select test_assert((select md5(row(broker_rate,loaded_miles,driver_brief)::text)=:'original_load_facts' and version>:'original_load_version'::bigint from loads where id='00000000-0000-0000-0000-000000009000'),'document changes signal load version without changing extracted financial facts');

-- Driver can read current nonprivate Rate Con, not superseded or removed bytes.
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(exists(select 1 from document_versions where id=(:'replacement'::jsonb->>'versionId')::uuid)
 and not exists(select 1 from document_versions where id=(:'first_upload'::jsonb->>'versionId')::uuid),'driver sees current Rate Con but not old version');
select test_assert(not exists(select 1 from media_assets where id='00000000-0000-0000-0000-000000009800'),'driver cannot newly sign superseded Cloudinary asset');
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'driver.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
select test_error($$select begin_document_upload('00000000-0000-0000-0000-000000009000',null,'rate_confirmation','driver.pdf','application/pdf',1)$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select remove_staff_load_document('00000000-0000-0000-0000-000000009000',(:'replacement'::jsonb->>'documentId')::uuid,(:'replacement'::jsonb->>'versionId')::uuid,'00000000-0000-0000-0000-000000009902');
select remove_staff_load_document('00000000-0000-0000-0000-000000009000',(:'replacement'::jsonb->>'documentId')::uuid,(:'replacement'::jsonb->>'versionId')::uuid,'00000000-0000-0000-0000-000000009902');
select test_assert((select count(*)=2 from document_versions where document_id=(:'replacement'::jsonb->>'documentId')::uuid),'staff removal retains historical versions');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(not exists(select 1 from documents where id=(:'replacement'::jsonb->>'documentId')::uuid)
 and not exists(select 1 from document_versions where document_id=(:'replacement'::jsonb->>'documentId')::uuid),'removed document and original fallback are hidden from driver');
reset role;

-- Explicit stop is mandatory; no accidental attachment to first pickup/delivery.
select id as pickup from load_stops where load_id='00000000-0000-0000-0000-000000009000' and type='pickup' \gset
select id as delivery from load_stops where load_id='00000000-0000-0000-0000-000000009000' and type='delivery' \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','bol',null,null,null,'bol.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_STOP_REQUIRED');
select test_error(format('select begin_staff_document_upload(%L,%L,%L,null,null,%L,%L,1,gen_random_uuid())','00000000-0000-0000-0000-000000009000','bol',:'delivery','bol.pdf','application/pdf'),'STAFF_DOCUMENT_STOP_INVALID');
select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','bol',:'pickup',null,null,'bol.pdf','application/pdf',10,'00000000-0000-0000-0000-000000009903') as bol \gset
reset role;
insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
values('00000000-0000-0000-0000-000000009802','00000000-0000-0000-0000-000000000020','load_document',(:'bol'::jsonb->>'versionId')::uuid,
 '00000000-0000-0000-0000-000000000001','application/pdf',10);
set role authenticated;
select complete_staff_document_upload((:'bol'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000009802');
reset role;
update load_stops set status='done' where id=:'pickup';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error(format('select delete_operational_document(%L)',:'bol'::jsonb->>'documentId'),'Required BOL/POD evidence cannot be changed');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select remove_staff_load_document('00000000-0000-0000-0000-000000009000',(:'bol'::jsonb->>'documentId')::uuid,(:'bol'::jsonb->>'versionId')::uuid,gen_random_uuid());
select test_assert(exists(select 1 from document_versions where id=(:'bol'::jsonb->>'versionId')::uuid),'authorized staff removal preserves completed-stop evidence as history');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'x.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'x.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
reset role;
select test_assert(not has_function_privilege('anon','begin_staff_document_upload(uuid,text,uuid,uuid,uuid,text,text,bigint,uuid)','execute')
 and not has_function_privilege('authenticated','private.authorized_staff_document_change(uuid)','execute')
 and not has_table_privilege('authenticated','private.staff_document_changes','insert'),'staff management private grants fail closed');

-- Restricted dispatchers cannot mutate documents of an out-of-scope driver.
insert into dispatcher_preferences(dispatcher_id,company_id,driver_scope)
values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','selected');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,null,null,'x.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
reset role;
insert into dispatcher_driver_access(dispatcher_id,driver_id,company_id)
values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020') on conflict do nothing;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','pod',:'delivery',null,null,'pod.pdf','application/pdf',10,gen_random_uuid()) as pod \gset
select test_assert((:'pod'::jsonb->>'versionId') is not null,'authorized scoped dispatcher can prepare POD');
select test_error($$select begin_document_upload('00000000-0000-0000-0000-000000009000',null,'rate_confirmation','legacy.pdf','application/pdf',1)$$,'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
reset role;

-- Old staff/driver Rate Con leases predating rollout cannot bypass the new API.
insert into documents(id,company_id,load_id,document_type,created_by)
values('00000000-0000-0000-0000-000000009950','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009000','rate_confirmation','00000000-0000-0000-0000-000000000001');
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,size_bytes,uploaded_by,upload_lease_started_at,upload_expires_at)
values('00000000-0000-0000-0000-000000009951','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009950',1,'legacy.pdf','application/pdf','legacy/staff.pdf',1,'00000000-0000-0000-0000-000000000001',now(),now()+interval '1 hour'),
('00000000-0000-0000-0000-000000009952','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009950',2,'legacy-driver.pdf','application/pdf','legacy/driver.pdf',1,'00000000-0000-0000-0000-000000000003',now(),now()+interval '1 hour');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select bind_document_version_media('00000000-0000-0000-0000-000000009951','cloudinary:00000000-0000-0000-0000-000000009800')$$,'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
select test_error($$select complete_document_upload('00000000-0000-0000-0000-000000009951')$$,'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select complete_document_upload('00000000-0000-0000-0000-000000009952')$$,'STAFF_DOCUMENT_PERMISSION_DENIED');

-- Receipt removal/reupload stays compatible with existing driver clients.
select begin_document_upload('00000000-0000-0000-0000-000000009000',null,'receipt','receipt.pdf','application/pdf',1) as receipt \gset
reset role;
insert into storage.objects(bucket_id,name) values('load-documents',:'receipt'::jsonb->>'storagePath');
set role authenticated;
select complete_document_upload((:'receipt'::jsonb->>'versionId')::uuid);
select delete_operational_document((:'receipt'::jsonb->>'documentId')::uuid);
select test_error(format('select complete_document_upload(%L)',:'receipt'::jsonb->>'versionId'),'STAFF_DOCUMENT_CONFLICT');
select begin_document_upload('00000000-0000-0000-0000-000000009000',null,'receipt','new-receipt.pdf','application/pdf',1) as new_receipt \gset
select test_assert(:'receipt'::jsonb->>'documentId'<>:'new_receipt'::jsonb->>'documentId','receipt reupload creates a fresh document instead of reviving tombstone');
reset role;
insert into storage.objects(bucket_id,name) values('load-documents',:'new_receipt'::jsonb->>'storagePath');
set role authenticated;
select complete_document_upload((:'new_receipt'::jsonb->>'versionId')::uuid);
select test_assert(exists(select 1 from documents where id=(:'new_receipt'::jsonb->>'documentId')::uuid and current_version_id is not null),'reuploaded receipt remains visible');
select test_assert(not exists(select 1 from storage.objects where name=:'receipt'::jsonb->>'storagePath')
 and exists(select 1 from storage.objects where name=:'new_receipt'::jsonb->>'storagePath'),'legacy Storage only signs current driver evidence');

-- A removed empty driver draft cannot later commit after staff/driver removal.
select begin_document_upload('00000000-0000-0000-0000-000000009000',:'delivery','pod','late.pdf','application/pdf',1) as late_pod \gset
select delete_operational_document((:'late_pod'::jsonb->>'documentId')::uuid);
select test_error(format('select complete_document_upload(%L)',:'late_pod'::jsonb->>'versionId'),'STAFF_DOCUMENT_CONFLICT');
reset role;

-- Re-adding a removed Rate Con invalidates the old removal acknowledgement.
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select begin_staff_document_upload('00000000-0000-0000-0000-000000009000','rate_confirmation',null,(:'replacement'::jsonb->>'documentId')::uuid,
 null,'restored.pdf','application/pdf',10,gen_random_uuid()) as readded \gset
reset role;
insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
values('00000000-0000-0000-0000-000000009803','00000000-0000-0000-0000-000000000020','load_document',(:'readded'::jsonb->>'versionId')::uuid,
 '00000000-0000-0000-0000-000000000003','application/pdf',10);
set role authenticated;
select test_error(format('select complete_staff_document_upload(%L,%L)',:'readded'::jsonb->>'versionId','cloudinary:00000000-0000-0000-0000-000000009803'),'STAFF_DOCUMENT_MEDIA_INVALID');
reset role;
update media_assets set uploaded_by='00000000-0000-0000-0000-000000000001' where id='00000000-0000-0000-0000-000000009803';
set role authenticated;
select complete_staff_document_upload((:'readded'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000009803');
select test_error(format('select remove_staff_load_document(%L,%L,%L,%L)','00000000-0000-0000-0000-000000009000',:'replacement'::jsonb->>'documentId',:'replacement'::jsonb->>'versionId','00000000-0000-0000-0000-000000009902'),'STAFF_DOCUMENT_CONFLICT');
reset role;
