reset role;
select test_seed_load('00000000-0000-0000-0000-000000009840');
update loads set driver_brief='{"version":1,"checksum":"audit-forward-review","reviewedAt":null,"blockingFields":["pickup.time"],"fields":[{"key":"loadNumber","value":"Synthetic review"}]}'
where id='00000000-0000-0000-0000-000000009840';
insert into manual_load_imports(company_id,created_by,checksum_sha256,source_file_name,mime_type,size_bytes,status,extraction_schema_version,extracted_result,load_id)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','audit-forward-review','synthetic.pdf','application/pdf',123,'needs_review',3,
'{"review":{"warningFields":["pickup.time","delivery.reference"]}}','00000000-0000-0000-0000-000000009840');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Synthetic driver',null,null);
select test_error($$select review_and_assign_document_load('00000000-0000-0000-0000-000000009840','00000000-0000-0000-0000-000000000004','stale-checksum')$$,'Document review is stale');
select test_assert((select driver_brief->>'reviewedAt' is null from loads where id='00000000-0000-0000-0000-000000009840'),'stale source cannot authorize review');
select (review_and_assign_document_load('00000000-0000-0000-0000-000000009840','00000000-0000-0000-0000-000000000004','audit-forward-review')).id as first_review_assignment \gset
select (review_and_assign_document_load('00000000-0000-0000-0000-000000009840','00000000-0000-0000-0000-000000000004','audit-forward-review')).id as retry_review_assignment \gset
select test_assert(:'first_review_assignment'=:'retry_review_assignment','review retry returns the same assignment');
select test_assert((select driver_brief->>'reviewedAt' is not null and driver_brief->'blockingFields'='[]'::jsonb and driver_brief->'warningFields'='["delivery.reference","pickup.time"]'::jsonb
 from loads where id='00000000-0000-0000-0000-000000009840'),'forward migration retains acknowledged, deduplicated source warnings');
select test_assert((select count(*)=1 from assignments where load_id='00000000-0000-0000-0000-000000009840' and status='active'),'forward review assigns exactly once');
reset role;
