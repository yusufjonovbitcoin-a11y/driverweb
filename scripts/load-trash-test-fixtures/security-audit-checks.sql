begin;
select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid) from generate_series(800,803)n;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Security driver',null,null);
select (assign_load_directly('00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000004')).id as trash_assignment \gset
select (trash_load('00000000-0000-0000-0000-000000000800',2)).id;
select (assign_load_directly('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000004')).id as active_assignment \gset
select load_revision as active_revision from assignments where id=:'active_assignment' \gset
select load_revision as trash_revision from assignments where id=:'trash_assignment' \gset
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Security driver',null,null,true);
select test_assert((select hide_rate_con from driver_pay_settings where driver_id='00000000-0000-0000-0000-000000000004'),'privacy updates with retained trashed assignment');
select test_assert((select load_revision=:'active_revision'::bigint+1 from assignments where id=:'active_assignment'),'active assignment revision invalidated');
select test_assert((select load_revision=:'trash_revision'::bigint from assignments where id=:'trash_assignment'),'trashed assignment untouched');
reset role;

-- A fully documented delivered load would have leaked its raw composite before.
insert into load_stops(id,company_id,load_id,type,sequence,address_line,city,region,requires_document,status)
values('00000000-0000-0000-0000-000000000811','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000801','pickup',1,'Test','City','ST',true,'done'),
('00000000-0000-0000-0000-000000000812','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000801','delivery',2,'Test','City','ST',true,'done');
insert into documents(id,company_id,load_id,stop_id,document_type,created_by)
values('00000000-0000-0000-0000-000000000821','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000811','bol','00000000-0000-0000-0000-000000000004'),
('00000000-0000-0000-0000-000000000822','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000812','pod','00000000-0000-0000-0000-000000000004'),
('00000000-0000-0000-0000-000000000823','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000803',null,'bol','00000000-0000-0000-0000-000000000001');
insert into document_versions(company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
select company_id,id,1,'proof.pdf','application/pdf',company_id||'/'||load_id||'/'||id||'/proof.pdf',created_by
from documents where id in ('00000000-0000-0000-0000-000000000821','00000000-0000-0000-0000-000000000822','00000000-0000-0000-0000-000000000823');
update documents d set current_version_id=v.id from document_versions v where v.document_id=d.id
and d.id in ('00000000-0000-0000-0000-000000000821','00000000-0000-0000-0000-000000000822','00000000-0000-0000-0000-000000000823');
insert into storage.objects select 'load-documents',storage_path from document_versions
where document_id in ('00000000-0000-0000-0000-000000000821','00000000-0000-0000-0000-000000000822','00000000-0000-0000-0000-000000000823');
update assignments set driver_stage='delivered',requires_reconfirmation=false where id=:'active_assignment';
update loads set status='delivered' where id='00000000-0000-0000-0000-000000000801';
select version as delivered_version from loads where id='00000000-0000-0000-0000-000000000801' \gset
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error($$select complete_load('00000000-0000-0000-0000-000000000801')$$,'Use advance_driver_route');
select test_assert((select value->>'broker_terms_hidden'='true' and (value->>'broker_rate')::numeric=0
from get_driver_load_rows(array['00000000-0000-0000-0000-000000000801'::uuid]) value),'driver still reads safe load projection');
select advance_driver_route('00000000-0000-0000-0000-000000000801','completed',gen_random_uuid(),:'delivered_version'::bigint) as completed_result \gset
select test_assert(:'completed_result'::jsonb->>'stage'='completed' and not (:'completed_result'::jsonb ? 'broker_rate'),'supported driver completion returns no broker price');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select delete_operational_document('00000000-0000-0000-0000-000000000821')$$,'Required BOL/POD cannot be deleted');
with removed as (delete from storage.objects where name like '%/00000000-0000-0000-0000-000000000821/%' returning *)
select test_assert((select count(*)=0 from removed),'admin cannot bypass retained BOL via Storage');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
with removed as (delete from storage.objects where name like '%/00000000-0000-0000-0000-000000000822/%' returning *)
select test_assert((select count(*)=0 from removed),'dispatcher cannot bypass retained POD via Storage');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select delete_operational_document('00000000-0000-0000-0000-000000000823');
with removed as (delete from storage.objects where name like '%/00000000-0000-0000-0000-000000000823/%' returning *)
select test_assert((select count(*)=1 from removed),'authorized document RPC still permits subsequent blob cleanup');
reset role;
update loads set status='delivered' where id='00000000-0000-0000-0000-000000000802';
set local role authenticated;
select test_assert((complete_load('00000000-0000-0000-0000-000000000802')).broker_rate=1000,'staff completion contract unchanged');
reset role;

insert into driver_presence(driver_id,company_id) values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000020') on conflict do nothing;
insert into location_snapshots(company_id,driver_id,event_type,latitude,longitude,captured_at)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000004','security_test',1,1,now());
insert into driver_tracking_sessions(assignment_id,company_id,driver_id,load_id,started_at)
values(:'active_assignment','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000801',now()) on conflict do nothing;
insert into driver_location_points(id,assignment_id,company_id,driver_id,load_id,latitude,longitude,accuracy_m,captured_at)
values(gen_random_uuid(),:'active_assignment','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000801',1,1,5,now());
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(exists(select 1 from assignments where id=:'active_assignment') and exists(select 1 from driver_presence)
and exists(select 1 from location_snapshots) and exists(select 1 from notifications)
and exists(select 1 from client_operations) and exists(select 1 from driver_tracking_sessions)
and exists(select 1 from driver_location_points),'active driver retains authorized self reads');
reset role;
update profiles set status='suspended' where id='00000000-0000-0000-0000-000000000004';
set local role authenticated;
select test_assert(not exists(select 1 from assignments) and not exists(select 1 from driver_presence)
and not exists(select 1 from location_snapshots) and not exists(select 1 from notifications)
and not exists(select 1 from client_operations) and not exists(select 1 from driver_tracking_sessions)
and not exists(select 1 from driver_location_points) and not exists(select 1 from offers),'same JWT loses self reads immediately after suspension');
select test_assert(not has_function_privilege('anon','complete_load(uuid)','execute')
and not has_function_privilege('anon','private.can_delete_load_document_object(text)','execute'),'anonymous privileged entrypoints denied');
rollback;
