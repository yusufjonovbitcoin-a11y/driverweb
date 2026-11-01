-- Synthetic data only. Receipts are optional, load-level files, not payment commands.
select md5(row(status,broker_rate,loaded_miles,driver_brief,current_assignment_id)::text) as receipt_load_facts
from loads where id='00000000-0000-0000-0000-000000009003' \gset
select id as receipt_wrong_stop from load_stops where load_id='00000000-0000-0000-0000-000000009003' limit 1 \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error(format('select begin_staff_document_upload(%L,%L,%L,null,null,%L,%L,1,gen_random_uuid())',
 '00000000-0000-0000-0000-000000009003','receipt',:'receipt_wrong_stop','receipt.pdf','application/pdf'),'STAFF_DOCUMENT_STOP_INVALID');
select test_error($$select begin_document_upload('00000000-0000-0000-0000-000000009003',null,'receipt','receipt.pdf','application/pdf',12)$$,'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,null,null,
 'receipt.pdf','application/pdf',12,'00000000-0000-0000-0000-000000008901') as staff_receipt \gset
select test_assert((begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,null,null,
 'receipt.pdf','application/pdf',12,'00000000-0000-0000-0000-000000008901')->>'versionId')=:'staff_receipt'::jsonb->>'versionId','retry reuses staged receipt');
reset role;
insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
values('00000000-0000-0000-0000-000000008801','00000000-0000-0000-0000-000000000020','load_document',(:'staff_receipt'::jsonb->>'versionId')::uuid,
 '00000000-0000-0000-0000-000000000001','application/pdf',12);
set role authenticated;
select test_error(format('select complete_document_upload(%L)',:'staff_receipt'::jsonb->>'versionId'),'STAFF_DOCUMENT_MANAGEMENT_REQUIRED');
select complete_staff_document_upload((:'staff_receipt'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000008801');
select complete_staff_document_upload((:'staff_receipt'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000008801');
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,null,null,
 'second.pdf','application/pdf',12,gen_random_uuid())$$,'STAFF_DOCUMENT_CONFLICT');
select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,(:'staff_receipt'::jsonb->>'documentId')::uuid,
 (:'staff_receipt'::jsonb->>'versionId')::uuid,'corrected.pdf','application/pdf',12,'00000000-0000-0000-0000-000000008902') as staff_receipt_new \gset
reset role;
insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
values('00000000-0000-0000-0000-000000008802','00000000-0000-0000-0000-000000000020','load_document',(:'staff_receipt_new'::jsonb->>'versionId')::uuid,
 '00000000-0000-0000-0000-000000000001','application/pdf',12);
set role authenticated;
select complete_staff_document_upload((:'staff_receipt_new'::jsonb->>'versionId')::uuid,'cloudinary:00000000-0000-0000-0000-000000008802');
select test_error(format('select remove_staff_load_document(%L,%L,%L,gen_random_uuid())',
 '00000000-0000-0000-0000-000000009003',:'staff_receipt'::jsonb->>'documentId',:'staff_receipt'::jsonb->>'versionId'),'STAFF_DOCUMENT_CONFLICT');
select remove_staff_load_document('00000000-0000-0000-0000-000000009003',(:'staff_receipt_new'::jsonb->>'documentId')::uuid,
 (:'staff_receipt_new'::jsonb->>'versionId')::uuid,'00000000-0000-0000-0000-000000008903');
select remove_staff_load_document('00000000-0000-0000-0000-000000009003',(:'staff_receipt_new'::jsonb->>'documentId')::uuid,
 (:'staff_receipt_new'::jsonb->>'versionId')::uuid,'00000000-0000-0000-0000-000000008903');
select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,(:'staff_receipt_new'::jsonb->>'documentId')::uuid,
 null,'again.pdf','application/pdf',12,gen_random_uuid()) as staff_receipt_again \gset
reset role;
select test_assert((select count(*)=3 from document_versions where document_id=(:'staff_receipt'::jsonb->>'documentId')::uuid),'receipt removal and reupload retain all prior versions');
select test_assert((select stop_id is null and document_type='receipt' from documents where id=(:'staff_receipt'::jsonb->>'documentId')::uuid),'receipt remains load-scoped');
select test_assert((select md5(row(status,broker_rate,loaded_miles,driver_brief,current_assignment_id)::text)=:'receipt_load_facts'
 from loads where id='00000000-0000-0000-0000-000000009003'),'receipt upload never changes load stage, prices or driver assignment');
select test_assert((select count(*)=2 from audit_events where entity_id=(:'staff_receipt'::jsonb->>'documentId')::uuid and action='document.staff_uploaded'),'upload retries produce no duplicate audit');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,null,null,'x.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,null,null,'x.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_error($$select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','receipt',null,null,null,'x.pdf','application/pdf',1,gen_random_uuid())$$,'STAFF_DOCUMENT_PERMISSION_DENIED');
reset role;
select test_assert(not has_function_privilege('anon','begin_staff_document_upload(uuid,text,uuid,uuid,uuid,text,text,bigint,uuid)','execute'),'receipt extension does not grant anonymous uploads');
