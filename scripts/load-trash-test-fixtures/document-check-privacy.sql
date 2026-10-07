-- Synthetic historic provider output: verify access boundaries, not real data.
select test_seed_load('00000000-0000-0000-0000-000000009300');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Privacy fixture',null,null,false);
select assign_load_directly('00000000-0000-0000-0000-000000009300','00000000-0000-0000-0000-000000000004');
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Privacy fixture',null,null,true);
reset role;
insert into documents(id,company_id,load_id,document_type,created_by) values
 ('00000000-0000-0000-0000-000000009310','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009300','bol','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000009311','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009300','pod','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000009312','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009300','rate_confirmation','00000000-0000-0000-0000-000000000001');
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
 select ('00000000-0000-0000-0000-'||lpad((n+10)::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000020',
 ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,1,'historic.pdf','application/pdf','historic/'||n,'00000000-0000-0000-0000-000000000001'
 from generate_series(9310,9312)n;
update documents d set current_version_id=v.id from document_versions v where v.document_id=d.id and d.load_id='00000000-0000-0000-0000-000000009300';
insert into document_checks(company_id,document_version_id,status,model_name,result)
 select company_id,current_version_id,'warning','historic-provider',
 '{"brokerRate":65432,"summary":"Unstructured historic price 65432","discrepancies":[{"code":"document_mismatch","params":{"field":"arbitrary","expected":"65432"}}]}'::jsonb
 from documents where load_id='00000000-0000-0000-0000-000000009300';
insert into warnings(company_id,load_id,document_check_id,code,params)
 select c.company_id,d.load_id,c.id,'document_mismatch','{"expected":"65432"}'::jsonb
 from document_checks c join documents d on d.current_version_id=c.document_version_id where d.load_id='00000000-0000-0000-0000-000000009300';

begin read only;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(not exists(select 1 from document_checks where document_version_id in
 ('00000000-0000-0000-0000-000000009320','00000000-0000-0000-0000-000000009321','00000000-0000-0000-0000-000000009322')),'hidden driver raw check REST rows denied');
select test_assert((select count(*)=2 and bool_and(check_status='warning' and check_result is null and check_model_name is null and active_warnings='[]'::jsonb)
 from document_review_overview where load_id='00000000-0000-0000-0000-000000009300'),'hidden driver BOL/POD status retained without any arbitrary historic JSON');
select test_assert(not exists(select 1 from document_review_overview where document_id='00000000-0000-0000-0000-000000009312'),'hidden Rate Con stays absent from view');
select test_assert((select count(*)=1 and bool_and(result is null and status='warning') from private.document_review_checks('00000000-0000-0000-0000-000000009310')),'private helper also returns safe status only');
select test_assert(not exists(select 1 from private.document_review_checks('00000000-0000-0000-0000-000000009312')),'private helper cannot reveal hidden Rate Con');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert((select count(*)=3 and bool_and(check_result->>'brokerRate'='65432') from document_review_overview where load_id='00000000-0000-0000-0000-000000009300'),'authorized staff retains full historical result and Rate Con');
select test_assert((select count(*)=3 from document_checks where document_version_id in
 ('00000000-0000-0000-0000-000000009320','00000000-0000-0000-0000-000000009321','00000000-0000-0000-0000-000000009322')),'authorized staff raw check access preserved');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_assert(not exists(select 1 from document_review_overview where load_id='00000000-0000-0000-0000-000000009300')
 and not exists(select 1 from private.document_review_checks('00000000-0000-0000-0000-000000009310'))
 and not exists(select 1 from document_checks where document_version_id='00000000-0000-0000-0000-000000009320'),'cross-tenant raw table, view and direct private helper denied');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_assert(not exists(select 1 from document_review_overview where load_id='00000000-0000-0000-0000-000000009300')
 and not exists(select 1 from private.document_review_checks('00000000-0000-0000-0000-000000009310'))
 and not exists(select 1 from document_checks where document_version_id='00000000-0000-0000-0000-000000009320'),'suspended actor raw table, view and direct private helper denied');
rollback;

-- Existing per-mile assignment must receive the same protection even with the
-- manual hide-rate switch off. No pay or historical check content is rewritten.
insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
 values('00000000-0000-0000-0000-000000009324','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000211',1,'paid.pdf','application/pdf','historic/paid','00000000-0000-0000-0000-000000000001');
update documents set current_version_id='00000000-0000-0000-0000-000000009324' where id='00000000-0000-0000-0000-000000000211';
insert into document_checks(company_id,document_version_id,status,result)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009324','passed','{"brokerRate":65432}');
begin read only;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(not exists(select 1 from document_checks where document_version_id='00000000-0000-0000-0000-000000009324'),'per-mile driver raw check JSON denied');
select test_assert((select check_status='passed' and check_result is null from document_review_overview where document_id='00000000-0000-0000-0000-000000000211'),'per-mile driver safe status preserved');
rollback;

-- A future status transition emits a documents event already consumed by mobile.
select updated_at as before_status from documents where id='00000000-0000-0000-0000-000000009310' \gset
select pg_sleep(0.01);
update document_checks set status='passed' where document_version_id='00000000-0000-0000-0000-000000009320';
select test_assert((select updated_at>:'before_status'::timestamptz from documents where id='00000000-0000-0000-0000-000000009310'),'safe document metadata changed for future status transition');
select test_assert(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='documents'),'safe document status signal is published');
select test_assert((select result->>'brokerRate'='65432' from document_checks where document_version_id='00000000-0000-0000-0000-000000009320'),'historical result content remains unchanged');
select test_assert(not has_function_privilege('anon','private.document_review_checks(uuid)','EXECUTE')
 and not has_table_privilege('anon','document_review_overview','SELECT'),'anonymous projection access denied');
select test_assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.document_review_overview'::regclass),'overview keeps caller RLS for documents and warnings');
begin read only;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert((select check_status='passed' and check_result is null from document_review_overview
 where document_id='00000000-0000-0000-0000-000000009310'),'hidden driver refetch receives terminal status after safe realtime signal');
rollback;
