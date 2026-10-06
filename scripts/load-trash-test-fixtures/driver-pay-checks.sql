-- The surrounding runner uses real core tables/FKs/assignment/trash commands.
-- Add permissive reads to fixture-only platform surfaces; restrictive production
-- policies must still hide broker information from a fixed-pay driver.
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table media_assets enable row level security;
alter table chat_messages enable row level security;
alter table storage.objects enable row level security;
alter table offers enable row level security;
alter table load_price_snapshots enable row level security;
alter table warnings enable row level security;
create policy test_read_docs on documents for select to authenticated using(can_access_load(load_id));
create policy test_read_versions on document_versions for select to authenticated using(true);
create policy test_read_media on media_assets for select to authenticated using(true);
create policy test_read_chat on chat_messages for select to authenticated using(true);
create policy test_read_storage on storage.objects for select to authenticated using(true);
create policy test_read_offers on offers for select to authenticated using(true);
create policy test_read_prices on load_price_snapshots for select to authenticated using(true);
create policy test_read_warnings on warnings for select to authenticated using(true);
grant usage on schema storage to authenticated;
grant select on storage.objects to authenticated;
select test_seed_load('00000000-0000-0000-0000-000000000200');
select test_seed_load('00000000-0000-0000-0000-000000000201');
select test_seed_load('00000000-0000-0000-0000-000000000202');
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region)
select '00000000-0000-0000-0000-000000000020',l.id,case when n<3 then 'pickup'::stop_type else 'delivery'::stop_type end,
 n,'Street '||n,'City','NJ' from loads l cross join generate_series(1,4)n where l.id::text like '%00000000020_';

set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (assign_load_directly('00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000003')).id as legacy_assignment \gset
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Old driver',null,0.65);
select test_assert(not exists(select 1 from assignment_driver_pay where assignment_id=:'legacy_assignment'),'setting does not backfill existing assignments');
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000003')$$,'DRIVER_PAY_ROUTE_REQUIRED');
select test_assert((select current_assignment_id is null from loads where id='00000000-0000-0000-0000-000000000201'),'missing GPS quote rolls entire assignment back');
reset role;
-- Only trusted service quote writer can persist measured distances.
select prepare_driver_pay_quote('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000001',0.65,1200.12,50.25,
 (select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,latitude,longitude) order by sequence,id)
 from load_stops where load_id='00000000-0000-0000-0000-000000000201'),40,-74,now(),'mapbox');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (assign_load_directly('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000003')).id as paid_assignment \gset
select test_assert((select amount=812.74 and total_miles=1250.37 and rate_per_mile=0.65 from assignment_driver_pay where assignment_id=:'paid_assignment'),'fixed pay includes deadhead + all route miles with cent rounding');
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Old driver',null,0.9);
select test_assert((select rate_per_mile=0.65 and amount=812.74 from assignment_driver_pay where assignment_id=:'paid_assignment'),'future rate changes never alter snapshot');
select (assign_load_directly('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000003')).id as retry_assignment \gset
select test_assert(:'retry_assignment'=:'paid_assignment','retry assignment is idempotent');
reset role;
insert into documents(id,company_id,load_id,document_type,created_by)
values('00000000-0000-0000-0000-000000000210','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000201','rate_confirmation','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000201','bol','00000000-0000-0000-0000-000000000001');
insert into document_versions(company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000210',1,'rate.pdf','application/pdf','cloudinary:00000000-0000-0000-0000-000000000212','00000000-0000-0000-0000-000000000001');
insert into media_assets(id) values('00000000-0000-0000-0000-000000000212');
insert into chat_messages(id,storage_path) values(gen_random_uuid(),'cloudinary:00000000-0000-0000-0000-000000000212');
insert into storage.objects values('load-documents','cloudinary:00000000-0000-0000-0000-000000000212');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(not exists(select 1 from loads where id='00000000-0000-0000-0000-000000000201'),'raw broker load row inaccessible');
select test_assert(exists(select 1 from loads where id='00000000-0000-0000-0000-000000000200'),'legacy assignment visibility preserved');
select test_assert((select value->>'broker_rate'='812.74' and value->'driver_brief'='null'::jsonb and value->'driver_pay'->>'rate_per_mile'='0.6500'
 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000201'::uuid]) value),'safe RPC exposes only driver pay');
select test_assert(not exists(select 1 from documents where id='00000000-0000-0000-0000-000000000210') and
 exists(select 1 from documents where id='00000000-0000-0000-0000-000000000211'),'Rate Con hidden, BOL retained');
select test_assert(not exists(select 1 from document_versions where document_id='00000000-0000-0000-0000-000000000210'),'original PDF versions blocked');
select test_assert(not exists(select 1 from media_assets where id='00000000-0000-0000-0000-000000000212'),'Cloudinary signing cannot read Rate Con asset');
select test_assert(not exists(select 1 from storage.objects where name='cloudinary:00000000-0000-0000-0000-000000000212'),'storage signed URL blocked');
select test_assert(not exists(select 1 from chat_messages where storage_path='cloudinary:00000000-0000-0000-0000-000000000212'),'shared original reference hidden in chat');
select test_error($$select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Cheat',null,99)$$,'permission required');
select test_assert(not has_table_privilege('authenticated','assignment_driver_pay','update'),'client cannot tamper with snapshot');
select test_assert(not has_function_privilege('authenticated','prepare_driver_pay_quote(uuid,uuid,uuid,numeric,numeric,numeric,jsonb,double precision,double precision,timestamptz,text)','execute'),'client cannot forge quote');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(not exists(select 1 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000201'::uuid])),'another driver cannot get load projection');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Foreign',null,1)$$,'Driver not found');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert((select broker_rate=1000 from loads where id='00000000-0000-0000-0000-000000000201'),'staff broker revenue unchanged');
select test_assert(exists(select 1 from documents where id='00000000-0000-0000-0000-000000000210'),'staff keeps Rate Con');
reset role;
update assignments set status='completed',ended_at=now()-interval '1 second' where id=:'paid_assignment';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((get_driver_analytics(now()-interval '10 seconds',now())->>'grossRevenue')::numeric=812.74,'analytics returns pay, multiple deliveries do not multiply revenue');
reset role;
select test_error($$update assignment_driver_pay set rate_per_mile=2$$,'immutable');
select prepare_driver_pay_quote('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000001',0.9,100,10,
 (select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,latitude,longitude) order by sequence,id)
 from load_stops where load_id='00000000-0000-0000-0000-000000000202'),40,-74,now(),'mapbox');
update load_stops set address_line='Changed route' where load_id='00000000-0000-0000-0000-000000000202' and sequence=1;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003')$$,'DRIVER_PAY_ROUTE_REQUIRED');
reset role;
update private.driver_pay_quotes set route_fingerprint=private.pay_route_fingerprint(load_id),created_at=now()-interval '6 minutes';
set role authenticated;
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003')$$,'DRIVER_PAY_ROUTE_REQUIRED');
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Old driver',null,0.95);
reset role;
update private.driver_pay_quotes set created_at=now();
set role authenticated;
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003')$$,'DRIVER_PAY_ROUTE_REQUIRED');
reset role;
select prepare_driver_pay_quote('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000001',0.95,100,10,
 (select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,latitude,longitude) order by sequence,id)
 from load_stops where load_id='00000000-0000-0000-0000-000000000202'),40,-74,now(),'mapbox');
set role authenticated;
select (assign_load_directly('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003')).id as new_paid_assignment \gset
select test_assert((select rate_per_mile=0.95 and amount=104.50 from assignment_driver_pay where assignment_id=:'new_paid_assignment'),
 'new assignment uses new rate; old assignment stays frozen');
select test_assert((select rate_per_mile=0.65 from assignment_driver_pay where assignment_id=:'paid_assignment'),'old snapshot unchanged after new assignment');
select (trash_load('00000000-0000-0000-0000-000000000202',(select version from loads where id='00000000-0000-0000-0000-000000000202'))).version as trash_version \gset
select test_error(format('select restore_trashed_load(%L,%s,%L)','00000000-0000-0000-0000-000000000202',:'trash_version','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_ROUTE_REQUIRED');
reset role;
select prepare_driver_pay_quote('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000001',0.95,100,20,
 (select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,latitude,longitude) order by sequence,id)
 from load_stops where load_id='00000000-0000-0000-0000-000000000202'),40,-74,now(),'mapbox');
set role authenticated;
select restore_trashed_load('00000000-0000-0000-0000-000000000202',:'trash_version','00000000-0000-0000-0000-000000000003');
select test_assert((select amount=104.50 from assignment_driver_pay where assignment_id=:'new_paid_assignment'),'restore keeps old pay history');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select (value->>'broker_rate')::numeric=114.00 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000202'::uuid]) value),
 'restored assignment reads new snapshot with newly measured deadhead');
reset role;
