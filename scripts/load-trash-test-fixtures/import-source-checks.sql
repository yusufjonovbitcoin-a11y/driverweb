select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid) from generate_series(12000,12008)n;
update loads set status='review' where id between '00000000-0000-0000-0000-000000012000' and '00000000-0000-0000-0000-000000012008';
insert into manual_load_imports(id,company_id,created_by,checksum_sha256,source_file_name,mime_type,size_bytes,status,load_id)
select ('00000000-0000-0000-0000-'||lpad((n+10000)::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000001',lpad(n::text,64,'0'),'source.pdf','application/pdf',123,'parse_failed',
  ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(12000,12008)n;
select test_assert(has_function_privilege('authenticated','begin_import_document_upload(uuid,text)','execute')
  and not has_function_privilege('anon','begin_import_document_upload(uuid,text)','execute')
  and has_function_privilege('service_role','complete_import_document_upload(uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('authenticated','complete_import_document_upload(uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('anon','complete_import_document_upload(uuid,uuid,text,uuid)','execute'),
  'only verified Edge service may attest original bytes; preparation requires authentication');
select test_assert(not has_table_privilege('authenticated','private.import_document_uploads','insert')
  and not has_function_privilege('authenticated','private.lock_source_document_import(uuid,text,uuid)','execute'),
  'private import authorization cannot be spoofed');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0')) as plan \gset
select test_assert(not (:'plan'::jsonb->>'alreadyUploaded')::boolean,'failed draft resumes with original pending source, not fake upload success');
select test_assert(begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))=:'plan'::jsonb,'repeated begin reuses exact lease and path');
select test_error($$select begin_document_upload('00000000-0000-0000-0000-000000012000',null,'rate_confirmation','source.pdf','application/pdf',123)$$,'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
select test_error(format('select complete_document_upload(%L)',:'plan'::jsonb->>'versionId'),'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022000',repeat('f',64))$$,'IMPORT_DOCUMENT_SOURCE_MISMATCH');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))$$,'IMPORT_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))$$,'IMPORT_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))$$,'IMPORT_DOCUMENT_PERMISSION_DENIED');
set role service_role;
select test_error(format('select complete_import_document_upload(%L,%L,%L,%L)','00000000-0000-0000-0000-000000022000',:'plan'::jsonb->>'versionId',lpad('12000',64,'0'),'00000000-0000-0000-0000-000000000001'),'IMPORT_DOCUMENT_FILE_MISMATCH');
select test_error(format('select complete_import_document_upload(%L,%L,%L,%L)','00000000-0000-0000-0000-000000022000',:'plan'::jsonb->>'versionId',lpad('12000',64,'0'),'00000000-0000-0000-0000-000000000006'),'IMPORT_DOCUMENT_PERMISSION_DENIED');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('load-documents',:'plan'::jsonb->>'storagePath',
 '00000000-0000-0000-0000-000000000002','{"size":123,"mimetype":"application/pdf"}');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))$$,'IMPORT_DOCUMENT_FILE_MISMATCH');
reset role;
update storage.objects set owner_id='00000000-0000-0000-0000-000000000001',metadata='{"size":124,"mimetype":"application/pdf"}' where name=:'plan'::jsonb->>'storagePath';
set role service_role;
select test_error(format('select complete_import_document_upload(%L,%L,%L,%L)','00000000-0000-0000-0000-000000022000',:'plan'::jsonb->>'versionId',lpad('12000',64,'0'),'00000000-0000-0000-0000-000000000001'),'IMPORT_DOCUMENT_FILE_MISMATCH');
reset role;
update storage.objects set metadata='{"size":123,"mimetype":"image/png"}' where name=:'plan'::jsonb->>'storagePath';
set role service_role;
select test_error(format('select complete_import_document_upload(%L,%L,%L,%L)','00000000-0000-0000-0000-000000022000',:'plan'::jsonb->>'versionId',lpad('12000',64,'0'),'00000000-0000-0000-0000-000000000001'),'IMPORT_DOCUMENT_FILE_MISMATCH');
reset role;
update storage.objects set metadata='{"size":123,"mimetype":"application/pdf"}' where name=:'plan'::jsonb->>'storagePath';
set role authenticated;
select test_assert((begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))->>'alreadyUploaded')::boolean,'lost upload response reuses matching Storage object without overwrite');
reset role;
select md5(row(broker_rate,loaded_miles,driver_brief)::text) as financial_hash from loads where id='00000000-0000-0000-0000-000000012000' \gset
set role service_role;
select complete_import_document_upload('00000000-0000-0000-0000-000000022000',(:'plan'::jsonb->>'versionId')::uuid,lpad('12000',64,'0'),'00000000-0000-0000-0000-000000000001');
select complete_import_document_upload('00000000-0000-0000-0000-000000022000',(:'plan'::jsonb->>'versionId')::uuid,lpad('12000',64,'0'),'00000000-0000-0000-0000-000000000001');
reset role;
select test_assert((select count(*)=1 from documents where load_id='00000000-0000-0000-0000-000000012000')
 and (select count(*)=1 from document_versions where document_id=(:'plan'::jsonb->>'documentId')::uuid),'completion retry creates no duplicate document/version');
select test_assert((select md5(row(broker_rate,loaded_miles,driver_brief)::text)=:'financial_hash' from loads where id='00000000-0000-0000-0000-000000012000'),'original upload does not alter extraction or financial fields');
select test_assert((select count(*)=1 from jobs where idempotency_key='document-check:'||(:'plan'::jsonb->>'versionId')),'completion retry creates one durable review job');
set role authenticated;
select test_assert((begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))->>'versionId')=:'plan'::jsonb->>'versionId','completed upload remains idempotent while exact original is current');

-- An expired pending lease receives a new path, never reuses ambiguous bytes.
select begin_import_document_upload('00000000-0000-0000-0000-000000022001',lpad('12001',64,'0')) as expired \gset
reset role;
update document_versions set upload_expires_at=clock_timestamp()-interval '1 second' where id=(:'expired'::jsonb->>'versionId')::uuid;
set role authenticated;
select begin_import_document_upload('00000000-0000-0000-0000-000000022001',lpad('12001',64,'0')) as renewed \gset
select test_assert(:'expired'::jsonb->>'versionId'<>:'renewed'::jsonb->>'versionId'
 and :'expired'::jsonb->>'documentId'=:'renewed'::jsonb->>'documentId','expired lease renews within the same source document');
set role service_role;
select test_error(format('select complete_import_document_upload(%L,%L,%L,%L)','00000000-0000-0000-0000-000000022001',:'expired'::jsonb->>'versionId',lpad('12001',64,'0'),'00000000-0000-0000-0000-000000000001'),'IMPORT_DOCUMENT_FILE_MISMATCH');
reset role;

-- Existing pending staff intent must not become a second concurrent original.
set role authenticated;
select begin_staff_document_upload('00000000-0000-0000-0000-000000012002','rate_confirmation',null,null,null,'source.pdf','application/pdf',123,gen_random_uuid());
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022002',lpad('12002',64,'0'))$$,'IMPORT_DOCUMENT_CONFLICT');
select remove_staff_load_document('00000000-0000-0000-0000-000000012000',(:'plan'::jsonb->>'documentId')::uuid,(:'plan'::jsonb->>'versionId')::uuid,gen_random_uuid());
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022000',lpad('12000',64,'0'))$$,'IMPORT_DOCUMENT_CONFLICT');
select trash_load('00000000-0000-0000-0000-000000012003',1);
reset role;
update loads set status='ready_for_offer' where id='00000000-0000-0000-0000-000000012004';
set role authenticated;
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022003',lpad('12003',64,'0'))$$,'IMPORT_DOCUMENT_LOAD_NOT_DRAFT');
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022004',lpad('12004',64,'0'))$$,'IMPORT_DOCUMENT_LOAD_NOT_DRAFT');
reset role;

-- Adopt a matching pre-migration original, not a new staff replacement.
insert into documents(id,company_id,load_id,document_type,created_by)
values('00000000-0000-0000-0000-000000032005','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000012005','rate_confirmation','00000000-0000-0000-0000-000000000001');
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,size_bytes,is_original,uploaded_by,checksum_sha256)
values('00000000-0000-0000-0000-000000042005','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000032005',1,'source.pdf','application/pdf',
 '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000012005/legacy/source.pdf',123,true,'00000000-0000-0000-0000-000000000001',lpad('12005',64,'0'));
update documents set current_version_id='00000000-0000-0000-0000-000000042005' where id='00000000-0000-0000-0000-000000032005';
update manual_load_imports set storage_path='00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000012005/legacy/source.pdf' where id='00000000-0000-0000-0000-000000022005';
insert into storage.objects(bucket_id,name,owner_id,metadata)
values('load-documents','00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000012005/legacy/source.pdf','00000000-0000-0000-0000-000000000001','{"size":123,"mimetype":"application/pdf"}');
set role authenticated;
select begin_import_document_upload('00000000-0000-0000-0000-000000022005',lpad('12005',64,'0')) as legacy \gset
select test_assert((:'legacy'::jsonb->>'alreadyUploaded')::boolean and :'legacy'::jsonb->>'versionId'='00000000-0000-0000-0000-000000042005','matching legacy source is reused without a duplicate');
set role service_role;
select complete_import_document_upload('00000000-0000-0000-0000-000000022005','00000000-0000-0000-0000-000000042005',lpad('12005',64,'0'),'00000000-0000-0000-0000-000000000001');
reset role;

-- A reused import may retain the former load's storage pointer. With no
-- documents on the new draft, upload fresh bytes; never attach/delete that file.
update manual_load_imports set storage_path='former-load/retained-original.pdf' where id='00000000-0000-0000-0000-000000022006';
insert into storage.objects(bucket_id,name,owner_id,metadata) values('load-documents','former-load/retained-original.pdf',
 '00000000-0000-0000-0000-000000000001','{"size":999,"mimetype":"application/pdf"}');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select begin_import_document_upload('00000000-0000-0000-0000-000000022006',lpad('12006',64,'0')) as stale_path_plan \gset
select test_assert(not (:'stale_path_plan'::jsonb->>'alreadyUploaded')::boolean
 and split_part(:'stale_path_plan'::jsonb->>'storagePath','/',2)='00000000-0000-0000-0000-000000012006',
 'stale former-load path creates a new upload strictly bound to the current draft');
reset role;
select test_assert((select storage_path='former-load/retained-original.pdf' from manual_load_imports where id='00000000-0000-0000-0000-000000022006'),
 'preparation does not overwrite old import metadata before upload acknowledgement');
insert into storage.objects(bucket_id,name,owner_id,metadata) values('load-documents',:'stale_path_plan'::jsonb->>'storagePath',
 '00000000-0000-0000-0000-000000000001','{"size":123,"mimetype":"application/pdf"}');
set role service_role;
select complete_import_document_upload('00000000-0000-0000-0000-000000022006',(:'stale_path_plan'::jsonb->>'versionId')::uuid,lpad('12006',64,'0'),'00000000-0000-0000-0000-000000000001');
reset role;
select test_assert((select storage_path=:'stale_path_plan'::jsonb->>'storagePath' from manual_load_imports where id='00000000-0000-0000-0000-000000022006')
 and exists(select 1 from storage.objects where name='former-load/retained-original.pdf' and metadata->>'size'='999'),
 'successful fresh upload updates only the import pointer and preserves the former original');

-- Existing current evidence is different: a mismatched source pointer must
-- still fail, not be silently adopted or replaced by the recovery exception.
insert into documents(id,company_id,load_id,document_type,created_by)
values('00000000-0000-0000-0000-000000032008','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000012008','rate_confirmation','00000000-0000-0000-0000-000000000001');
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,size_bytes,is_original,uploaded_by,checksum_sha256)
values('00000000-0000-0000-0000-000000042008','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000032008',1,'source.pdf','application/pdf',
 '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000012008/legacy/source.pdf',123,true,'00000000-0000-0000-0000-000000000001',lpad('12008',64,'0'));
update documents set current_version_id='00000000-0000-0000-0000-000000042008' where id='00000000-0000-0000-0000-000000032008';
update manual_load_imports set storage_path='another-source/should-not-be-reused.pdf' where id='00000000-0000-0000-0000-000000022008';
set role authenticated;
select test_error($$select begin_import_document_upload('00000000-0000-0000-0000-000000022008',lpad('12008',64,'0'))$$,'IMPORT_DOCUMENT_CONFLICT');
reset role;
select test_assert(not exists(select 1 from private.import_document_uploads where import_id='00000000-0000-0000-0000-000000022008')
 and (select count(*)=1 from documents where load_id='00000000-0000-0000-0000-000000012008'),
 'legacy evidence source mismatch leaves the current document unchanged');
