-- Only synthetic rows in the isolated database created by the test runner.
select test_assert(not has_function_privilege('anon','prepare_import_assignment_upload(uuid,text)','execute')
  and not has_function_privilege('authenticated','finalize_import_assignment_source(uuid,uuid,text,uuid,text)','execute'),
  'anonymous prepare and browser checksum attestation remain forbidden');
insert into manual_load_imports(id,company_id,created_by,checksum_sha256,source_file_name,mime_type,size_bytes,
  extraction_schema_version,raw_extraction)
values('00000000-0000-0000-0000-000000023001','00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000001',repeat('c',64),'confirmation.pdf','application/pdf',123,4,
  jsonb_build_object('draft',jsonb_build_object('load_number','BATCH-TEST','broker_rate',1000,'loaded_miles',500,
    'pickup',jsonb_build_object('addressLine','1 First Ave','city','Phoenix','region','AZ'),
    'delivery',jsonb_build_object('addressLine','2 Second Ave','city','Dallas','region','TX')),
    'confirmation',jsonb_build_object('loadNumber','#BATCH-TEST','review',jsonb_build_object('checksum',repeat('c',64)),
      'driverBrief',jsonb_build_object('checksum',repeat('c',64),'fields','[{"key":"loadNumber","value":"BATCH-TEST"}]'::jsonb,
        'blockingFields','[]'::jsonb,'reviewedAt',null),
      'brokerContact','Test Contact','brokerPhone','555-0100','requirements','[]'::jsonb,'missingFields','[]'::jsonb,
      'stops','[{"role":"pickup","addressLine":"1 First Ave","city":"Phoenix","region":"AZ"},
        {"role":"delivery","addressLine":"2 Second Ave","city":"Dallas","region":"TX"}]'::jsonb)));
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select prepare_import_assignment_upload('00000000-0000-0000-0000-000000023001',repeat('c',64))$$,
  'IMPORT_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select prepare_import_assignment_upload('00000000-0000-0000-0000-000000023001',repeat('c',64))$$,
  'IMPORT_CONFIRMATION_SNAPSHOT_INVALID');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_error($$select prepare_import_assignment_upload('00000000-0000-0000-0000-000000023001',repeat('c',64))$$,
  'IMPORT_CONFIRMATION_SNAPSHOT_INVALID');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select prepare_import_assignment_upload('00000000-0000-0000-0000-000000023001',repeat('d',64))$$,
  'IMPORT_CONFIRMATION_SNAPSHOT_INVALID');
select prepare_import_assignment_upload('00000000-0000-0000-0000-000000023001',repeat('c',64)) as plan \gset
select test_assert((select count(*)=1 from loads where load_number='BATCH-TEST'),'one durable draft after prepare');
select test_assert(prepare_import_assignment_upload('00000000-0000-0000-0000-000000023001',repeat('c',64))->>'versionId'
  =(:'plan'::jsonb->>'versionId'),'prepare replay reuses source version');
select test_assert((select current_assignment_id is null from loads where id=(:'plan'::jsonb->>'loadId')::uuid),
  'preparation cannot assign a driver');
reset role;
-- Missing Storage bytes cannot finalize. All mutations roll back.
set role service_role;
select test_error(format('select finalize_import_assignment_source(%L,%L,%L,%L,%L)',
  '00000000-0000-0000-0000-000000023001',:'plan'::jsonb->>'versionId',repeat('c',64),
  '00000000-0000-0000-0000-000000000001','test'),'IMPORT_DOCUMENT_FILE_MISMATCH');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('load-documents',:'plan'::jsonb->>'storagePath',
 '00000000-0000-0000-0000-000000000001','{"size":123,"mimetype":"application/pdf"}');
-- A late snapshot failure must roll back the document publication too.
update manual_load_imports set raw_extraction=jsonb_set(raw_extraction,'{confirmation,driverBrief,checksum}','"bad"')
 where id='00000000-0000-0000-0000-000000023001';
set role service_role;
select test_error(format('select finalize_import_assignment_source(%L,%L,%L,%L,%L)',
  '00000000-0000-0000-0000-000000023001',:'plan'::jsonb->>'versionId',repeat('c',64),
  '00000000-0000-0000-0000-000000000001','test'),'IMPORT_CONFIRMATION_SNAPSHOT_INVALID');
reset role;
select test_assert((select current_version_id is null from documents where id=(:'plan'::jsonb->>'documentId')::uuid),
 'failed finalize cannot publish a partially checked document');
update manual_load_imports set raw_extraction=jsonb_set(raw_extraction,'{confirmation,driverBrief,checksum}',to_jsonb(repeat('c',64)))
 where id='00000000-0000-0000-0000-000000023001';
set role service_role;
select finalize_import_assignment_source('00000000-0000-0000-0000-000000023001',
  (:'plan'::jsonb->>'versionId')::uuid,repeat('c',64),'00000000-0000-0000-0000-000000000001','test');
reset role;
select test_assert((select status='needs_review' and extracted_result->>'id'=:'plan'::jsonb->>'loadId'
  from manual_load_imports where id='00000000-0000-0000-0000-000000023001'),'completed source is ready for review');
select test_assert((select broker_contact_name='Test Contact' and broker_phone='555-0100'
  from loads where id=(:'plan'::jsonb->>'loadId')::uuid),'batch preserves metadata');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select review_and_assign_document_load((:'plan'::jsonb->>'loadId')::uuid,
 '00000000-0000-0000-0000-000000000003',repeat('c',64));
reset role;
select test_assert((select status='assigned' and current_assignment_id is not null from loads
 where id=(:'plan'::jsonb->>'loadId')::uuid),'source validation precedes atomic driver acceptance');
