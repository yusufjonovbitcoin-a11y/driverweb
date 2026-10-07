-- Real production create_load_draft: throw AFTER it inserted the load, stops,
-- price snapshot and audit event but BEFORE the import link can commit.
insert into manual_load_imports(id,company_id,created_by,checksum_sha256,source_file_name,mime_type,size_bytes,raw_extraction)
values('00000000-0000-0000-0000-000000009001','00000000-0000-0000-0000-000000000020',
 '00000000-0000-0000-0000-000000000001','atomic-test','fixture.pdf','application/pdf',10,
 '{"draft":{"load_number":"ATOMIC-AUDIT","broker_rate":1000,"loaded_miles":500,"pickup":{"addressLine":"A","city":"A","region":"AZ"},"delivery":{"addressLine":"B","city":"B","region":"TX"}}}');
create function test_fail_import_link() returns trigger language plpgsql as $$
begin raise exception 'INJECTED_AFTER_CREATE_BEFORE_LINK'; end $$;
create trigger test_fail_import_link before update of load_id on manual_load_imports
 for each row when(new.id='00000000-0000-0000-0000-000000009001') execute function test_fail_import_link();
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select create_document_import_draft('00000000-0000-0000-0000-000000009001','atomic-test')$$,'INJECTED_AFTER_CREATE_BEFORE_LINK');
reset role;
select test_assert(not exists(select 1 from loads where load_number='ATOMIC-AUDIT'),'crash before import link leaves no orphan load');
select test_assert((select load_id is null from manual_load_imports where checksum_sha256='atomic-test'),'failed transaction retains retryable import');
drop trigger test_fail_import_link on manual_load_imports;
set role authenticated;
select create_document_import_draft('00000000-0000-0000-0000-000000009001','atomic-test') as imported_load \gset
select test_assert(create_document_import_draft('00000000-0000-0000-0000-000000009001','atomic-test')=:'imported_load'::uuid,'lost-response retry returns linked draft');
select test_error($$select create_document_import_draft('00000000-0000-0000-0000-000000009001','wrong-checksum')$$,'Import not found');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select create_document_import_draft('00000000-0000-0000-0000-000000009001','atomic-test')$$,'Import not found');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_error($$select create_document_import_draft('00000000-0000-0000-0000-000000009001','atomic-test')$$,'Dispatcher permission required');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select create_document_import_draft('00000000-0000-0000-0000-000000009001','atomic-test')$$,'Dispatcher permission required');
reset role;
select test_assert((select count(*)=1 from loads where load_number='ATOMIC-AUDIT'),'import creates exactly one load');
select test_assert((select count(*)=2 from load_stops where load_id=:'imported_load'),'atomic draft includes real stops');
select test_assert(not has_table_privilege('authenticated','manual_load_imports','UPDATE'),'caller cannot forge prepared extraction');
select test_assert(not has_function_privilege('authenticated','claim_document_check(text,uuid)','EXECUTE')
 and not has_function_privilege('anon','finish_document_check(uuid,text,uuid,document_check_status,numeric,text,jsonb,jsonb)','EXECUTE'),'queue leases restricted to service role');

-- Upload acknowledged but app dies before dispatch: durable job is claimable.
insert into documents(id,company_id,load_id,document_type,created_by) values
 ('00000000-0000-0000-0000-000000009010','00000000-0000-0000-0000-000000000020',:'imported_load','bol','00000000-0000-0000-0000-000000000001');
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by) values
 ('00000000-0000-0000-0000-000000009011','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009010',1,'test.pdf','application/pdf','audit/test.pdf','00000000-0000-0000-0000-000000000001');
update documents set current_version_id='00000000-0000-0000-0000-000000009011' where id='00000000-0000-0000-0000-000000009010';
insert into document_checks(id,company_id,document_version_id) values
 ('00000000-0000-0000-0000-000000009012','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009011');
insert into jobs(id,company_id,type,payload,idempotency_key) values
 ('00000000-0000-0000-0000-000000009013','00000000-0000-0000-0000-000000000020','document.ai_check',
 jsonb_build_object('documentVersionId','00000000-0000-0000-0000-000000009011','loadId',:'imported_load'),'audit-document-check');
set role service_role;
select test_assert(claim_document_check('first-worker-lease','00000000-0000-0000-0000-000000009011')->>'checkId'='00000000-0000-0000-0000-000000009012','missed foreground dispatch recovered');
select test_assert(claim_document_check('second-worker-lease','00000000-0000-0000-0000-000000009011') is null,'live lease prevents concurrent paid check');
reset role;
update jobs set locked_at=now()-interval '3 minutes' where id='00000000-0000-0000-0000-000000009013';
set role service_role;
select test_assert(claim_document_check('second-worker-lease','00000000-0000-0000-0000-000000009011') is not null,'crashed worker checking lease recovered');
select test_assert(not finish_document_check('00000000-0000-0000-0000-000000009013','first-worker-lease','00000000-0000-0000-0000-000000009012','passed',1,'test','{}'),'late result cannot overwrite reclaimed lease');
select test_assert(finish_document_check('00000000-0000-0000-0000-000000009013','second-worker-lease','00000000-0000-0000-0000-000000009012','failed_to_read',0,'test','{}'),'transient failure is durably recorded');
select test_assert(claim_document_check('third-worker-lease','00000000-0000-0000-0000-000000009011') is null,'retry observes backoff');
reset role;
select test_assert((select status='failed' and locked_by is null and available_at>now() from jobs where id='00000000-0000-0000-0000-000000009013'),'job failure and review result committed together');
update jobs set available_at=now()-interval '1 second' where id='00000000-0000-0000-0000-000000009013';
set role service_role;
select test_assert(claim_document_check('third-worker-lease','00000000-0000-0000-0000-000000009011') is not null,'due failed job retried');
select test_assert(finish_document_check('00000000-0000-0000-0000-000000009013','third-worker-lease','00000000-0000-0000-0000-000000009012','passed',1,'test','{}'),'successful review committed');
select test_assert(not finish_document_check('00000000-0000-0000-0000-000000009013','third-worker-lease','00000000-0000-0000-0000-000000009012','failed_to_read',0,'test','{}'),'ambiguous completion retry cannot revert success');
reset role;
select test_assert((select status='completed' and locked_by is null from jobs where id='00000000-0000-0000-0000-000000009013'),'successful result completes job');
select test_assert((select status='passed' from document_checks where id='00000000-0000-0000-0000-000000009012'),'successful result remains passed');
update jobs set status='pending',attempt_count=0,available_at=now() where id='00000000-0000-0000-0000-000000009013';
update document_checks set status='queued' where id='00000000-0000-0000-0000-000000009012';
update documents set document_type='receipt' where id='00000000-0000-0000-0000-000000009010';
select test_assert(claim_document_check('receipt-worker-lease','00000000-0000-0000-0000-000000009011') is null,'receipt never starts paid AI review');
update documents set document_type='bol' where id='00000000-0000-0000-0000-000000009010';
update jobs set status='processing',attempt_count=max_attempts,locked_at=now()-interval '3 minutes',locked_by='crashed-worker-lease' where id='00000000-0000-0000-0000-000000009013';
update document_checks set status='checking' where id='00000000-0000-0000-0000-000000009012';
select test_assert(claim_document_check('final-worker-lease','00000000-0000-0000-0000-000000009011') is null,'exhausted crashed job cannot loop forever');
select test_assert((select status='dead_letter' from jobs where id='00000000-0000-0000-0000-000000009013')
 and (select status='failed_to_read' from document_checks where id='00000000-0000-0000-0000-000000009012'),'exhausted check leaves checking status');
