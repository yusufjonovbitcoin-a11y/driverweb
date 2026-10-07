begin;
select test_seed_load('00000000-0000-0000-0000-000000000600');
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Privacy driver',null,null);
select (assign_load_directly('00000000-0000-0000-0000-000000000600','00000000-0000-0000-0000-000000000004')).id as private_assignment \gset
reset role;
insert into documents(id,company_id,load_id,document_type,created_by) values
('00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000600','rate_confirmation','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000600','bol','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000600','pod','00000000-0000-0000-0000-000000000001');
insert into document_versions(company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000610',1,'rate.pdf','application/pdf','cloudinary:00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000000001');
insert into media_assets(id) values('00000000-0000-0000-0000-000000000613');
insert into chat_messages(id,storage_path) values(gen_random_uuid(),'cloudinary:00000000-0000-0000-0000-000000000613');
insert into storage.objects values('load-documents','cloudinary:00000000-0000-0000-0000-000000000613');
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(exists(select 1 from documents where id='00000000-0000-0000-0000-000000000610'),'Rate Con visible by default');
select test_error($$select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Tamper',null,null,false)$$,'permission required');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Foreign',null,null,true)$$,'Driver not found');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select load_revision as revision_before from assignments where id=:'private_assignment' \gset
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Privacy driver',null,null,true);
select test_assert((select load_revision=(:'revision_before')::bigint+1 from assignments where id=:'private_assignment'),'privacy invalidates existing assignments');
select test_assert((select broker_rate=1000 from loads where id='00000000-0000-0000-0000-000000000600'),'staff rate unchanged');
select test_assert(exists(select 1 from documents where id='00000000-0000-0000-0000-000000000610'),'staff PDF retained');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(not exists(select 1 from loads where id='00000000-0000-0000-0000-000000000600'),'raw load denied');
select test_assert((select value->>'broker_terms_hidden'='true' and (value->>'broker_rate')::numeric=0
 and value->'driver_pay'='null'::jsonb and value->'driver_brief'='null'::jsonb
 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000600'::uuid]) value),'safe projection no broker terms without fixed pay');
select test_assert(not exists(select 1 from documents where id='00000000-0000-0000-0000-000000000610'),'Rate Con inaccessible');
select test_assert((select count(*)=2 from documents where load_id='00000000-0000-0000-0000-000000000600'),'BOL and POD remain accessible');
select test_assert(not exists(select 1 from document_versions where document_id='00000000-0000-0000-0000-000000000610'),'original versions denied');
select test_assert(not exists(select 1 from media_assets where id='00000000-0000-0000-0000-000000000613'),'Cloudinary signing denied');
select test_assert(not exists(select 1 from storage.objects where name='cloudinary:00000000-0000-0000-0000-000000000613'),'storage denied');
select test_assert(not exists(select 1 from chat_messages where storage_path='cloudinary:00000000-0000-0000-0000-000000000613'),'shared file reference denied');
reset role;
update assignments set status='completed',ended_at=now()-interval '1 second' where id=:'private_assignment';
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert((get_driver_analytics(null,now())->>'grossRevenue')::numeric=0,'analytics cannot leak hidden broker revenue');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Privacy driver',null,null,false);
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(exists(select 1 from documents where id='00000000-0000-0000-0000-000000000610'),'turning off restores access without reupload');
select test_assert((select value->>'broker_terms_hidden'='false' and (value->>'broker_rate')::numeric=1000
 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000600'::uuid]) value),'ordinary rate restored');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000003','Paid driver',null,0.95,false);
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select value->>'broker_terms_hidden'='true' and (value->>'broker_rate')::numeric=812.74
 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000201'::uuid]) value),'disabling manual privacy cannot bypass fixed-pay protection');
rollback;
