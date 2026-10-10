-- Runs after the original pay/privacy suites, proving compatibility as well as
-- the new behavior. These UUIDs are isolated fixture data, never production.
select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid) from generate_series(800,810)n;
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region)
select '00000000-0000-0000-0000-000000000020',l.id,
  case when n=1 then 'pickup'::stop_type else 'delivery'::stop_type end,n,'Pay street '||n,'City','NY'
from loads l cross join generate_series(1,2)n where l.id between
  '00000000-0000-0000-0000-000000000800' and '00000000-0000-0000-0000-000000000810';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000003','Paid driver',null,0.7,false);
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Other driver',null,null,false);
select (assign_load_directly('00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000003')).id as pending_assignment \gset
select test_assert((select rate_per_mile=0.7 from assignment_driver_pay_pending where assignment_id=:'pending_assignment'),'missing GPS allows assignment and freezes exact rate');
select test_assert(not exists(select 1 from assignment_driver_pay where assignment_id=:'pending_assignment'),'no invented finalized money/miles');
select test_assert(not exists(select 1 from information_schema.columns where table_name='assignment_driver_pay_pending'
  and column_name in ('loaded_miles','deadhead_miles','amount','origin_latitude','origin_longitude','location_at')),'pending terms do not store zero distances or fake GPS');
select test_assert((assign_load_directly('00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000003')).id=:'pending_assignment'::uuid,'pending assignment retry is idempotent');
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Paid driver',null,0.9);
select test_assert((select rate_per_mile=0.7 from assignment_driver_pay_pending where assignment_id=:'pending_assignment'),'profile rate changes cannot change pending assignment rate');
reset role;

-- Assignment-time quotes, including valid fresh ones, never settle START-based pay.
select prepare_driver_pay_quote('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000003',
 '00000000-0000-0000-0000-000000000001',0.9,100,10,
 (select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,latitude,longitude) order by sequence,id)
 from load_stops where load_id='00000000-0000-0000-0000-000000000801'),40,-74,now(),'mapbox');
insert into private.driver_pay_quotes(load_id,driver_id,requested_by,rate_per_mile,loaded_miles,deadhead_miles,
  route_fingerprint,origin_latitude,origin_longitude,location_at,provider,created_at)
select l.id,'00000000-0000-0000-0000-000000000003',
  case when l.id::text like '%804' then '00000000-0000-0000-0000-000000000002'::uuid else '00000000-0000-0000-0000-000000000001'::uuid end,
  case when l.id::text like '%805' then 0.8 else 0.9 end,100,10,
  case when l.id::text like '%803' then 'wrong-route' else private.pay_route_fingerprint(l.id) end,40,-74,
  case when l.id::text like '%802' then now()-interval '2 minutes' else now() end,'mapbox',now()
from loads l where l.id between '00000000-0000-0000-0000-000000000802' and '00000000-0000-0000-0000-000000000805';
set role authenticated;
select (assign_load_directly('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000003')).id as ready_assignment \gset
select test_assert(not exists(select 1 from assignment_driver_pay where assignment_id=:'ready_assignment')
 and exists(select 1 from assignment_driver_pay_pending where assignment_id=:'ready_assignment'),'fresh assignment quote is ignored until driver START');
select assign_load_directly(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000003') from generate_series(802,809)n;
select test_assert((select count(*)=4 from assignment_driver_pay_pending where load_id between
 '00000000-0000-0000-0000-000000000802' and '00000000-0000-0000-0000-000000000805'),'stale GPS, changed route, foreign actor and old rate quotes all become pending');
select (assign_load_directly('00000000-0000-0000-0000-000000000810','00000000-0000-0000-0000-000000000004')).id as unpaid_assignment \gset
select test_assert(not exists(select 1 from assignment_driver_pay_pending where assignment_id=:'unpaid_assignment')
 and not exists(select 1 from assignment_driver_pay where assignment_id=:'unpaid_assignment'),'driver without configured mileage pay remains unchanged');
reset role;

-- Original documents and broker money remain inaccessible while pending.
insert into documents(id,company_id,load_id,document_type,created_by) values
 ('00000000-0000-0000-0000-000000000850','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000800','rate_confirmation','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000851','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000800','bol','00000000-0000-0000-0000-000000000001');
insert into document_versions(company_id,document_id,version_number,file_name,mime_type,storage_path,uploaded_by)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000850',1,'rate.pdf','application/pdf',
 'cloudinary:00000000-0000-0000-0000-000000000852','00000000-0000-0000-0000-000000000001');
insert into media_assets(id,company_id) values('00000000-0000-0000-0000-000000000852','00000000-0000-0000-0000-000000000020');
insert into chat_messages(id,storage_path) values(gen_random_uuid(),'cloudinary:00000000-0000-0000-0000-000000000852');
insert into storage.objects values('load-documents','cloudinary:00000000-0000-0000-0000-000000000852');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(exists(select 1 from assignment_driver_pay_pending where assignment_id=:'pending_assignment'),'driver reads own pending frozen terms');
select test_assert(not exists(select 1 from loads where id='00000000-0000-0000-0000-000000000800'),'pending blocks raw broker load row');
select test_assert((select value->>'driver_pay_status'='pending' and (value->>'driver_rate_per_mile')::numeric=0.7
 and value->'driver_pay'='null'::jsonb and value->'broker_rate'='null'::jsonb and value->>'broker_terms_hidden'='true'
 and value ? 'driver_stop_details' from get_driver_load_rows(array['00000000-0000-0000-0000-000000000800'::uuid]) value),'pending projection preserves stop fields, rate and explicit unknown price');
select test_assert(not exists(select 1 from documents where id='00000000-0000-0000-0000-000000000850')
 and exists(select 1 from documents where id='00000000-0000-0000-0000-000000000851'),'pending hides Rate Con but preserves BOL');
select test_assert(not exists(select 1 from document_versions where document_id='00000000-0000-0000-0000-000000000850')
 and not exists(select 1 from media_assets where id='00000000-0000-0000-0000-000000000852')
 and not exists(select 1 from storage.objects where name='cloudinary:00000000-0000-0000-0000-000000000852')
 and not exists(select 1 from chat_messages where storage_path='cloudinary:00000000-0000-0000-0000-000000000852'),'pending protects signed URLs and shared file references');
select test_assert(not has_table_privilege('authenticated','assignment_driver_pay_pending','update')
 and not has_table_privilege('authenticated','assignment_driver_pay_pending','insert')
 and not has_table_privilege('authenticated','assignment_driver_pay_pending','delete')
 and not has_table_privilege('anon','assignment_driver_pay_pending','select')
 and not has_function_privilege('anon','start_driver_load_with_pay(uuid,uuid,bigint,timestamptz,numeric,numeric,numeric)','execute')
 and not has_function_privilege('authenticated','claim_driver_pay_calculation(text,uuid)','execute')
 and not has_function_privilege('authenticated','finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean)','execute'),'pending and resolver have least privilege grants');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(not exists(select 1 from assignment_driver_pay_pending where assignment_id=:'pending_assignment'),'other driver cannot read pending pay');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_assert(not exists(select 1 from assignment_driver_pay_pending),'foreign company cannot read pending pay');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_assert(not exists(select 1 from assignment_driver_pay_pending),'suspended account cannot read pending pay');
reset role;

-- Analytics retains pending trips, but never substitutes the broker price/zero
-- into those individual financial facts; only known amounts enter aggregate sums.
update assignments set status='completed',ended_at=now()-interval '1 second' where id=:'pending_assignment';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
begin read only;
select get_driver_analytics(now()-interval '1 minute',now()) as pending_analytics \gset
select test_assert((:'pending_analytics'::jsonb->>'pendingPayCount')::int=1
 and (:'pending_analytics'::jsonb->>'hasPendingPay')::boolean,'analytics flags pending completed compensation');
select test_assert(exists(select 1 from jsonb_array_elements(:'pending_analytics'::jsonb->'recentLoads') value
 where value->>'loadId'='00000000-0000-0000-0000-000000000800' and value->>'driverPayStatus'='pending'
 and value->'grossRevenue'='null'::jsonb and value->'loadedMiles'='null'::jsonb and value->'deadheadMiles'='null'::jsonb),'pending analytics row has unknown money and distances');
select test_assert(exists(select 1 from jsonb_array_elements(:'pending_analytics'::jsonb->'daily') value
 where (value->>'pendingPayCount')::int=1 and (value->>'hasPendingPay')::boolean),'daily analytics identifies unsettled subtotal');
select test_assert((:'pending_analytics'::jsonb->>'activePendingPayCount')::int>=1,'analytics distinguishes active pending trips');
rollback;
reset role;


-- Reset only local fixture completion so START can exercise its active stage.
update assignments set status='active',ended_at=null where id=:'pending_assignment';
select test_assert(not exists(select 1 from private.driver_pay_quotes where load_id between
 '00000000-0000-0000-0000-000000000800' and '00000000-0000-0000-0000-000000000810'),'all assignment quotes consumed without using GPS');
select version as start_version from loads where id='00000000-0000-0000-0000-000000000800' \gset
select now() as captured_at \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select start_driver_load_with_pay('00000000-0000-0000-0000-000000000800',gen_random_uuid(),1,now(),40,-74,5)$$,'DRIVER_PAY_START_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error($$select start_driver_load_with_pay('00000000-0000-0000-0000-000000000800',gen_random_uuid(),1,now(),40,-74,5)$$,'DRIVER_PAY_START_ASSIGNMENT_CHANGED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error(format('select advance_driver_stage(%L,%L,gen_random_uuid(),%s)','00000000-0000-0000-0000-000000000800','en_route_to_pickup',:'start_version'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select advance_driver_route(%L,%L,gen_random_uuid(),%s)','00000000-0000-0000-0000-000000000800','en_route_to_pickup',:'start_version'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now(),null,null,null)','00000000-0000-0000-0000-000000000800',:'start_version'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now()-interval %L,40,-74,5)','00000000-0000-0000-0000-000000000800',:'start_version','3 minutes'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now()-interval %L,40,-74,5)','00000000-0000-0000-0000-000000000800',:'start_version','2 minutes'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now()+interval %L,40,-74,5)','00000000-0000-0000-0000-000000000800',:'start_version','31 seconds'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now(),40,-74,101)','00000000-0000-0000-0000-000000000800',:'start_version'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now(),%L::numeric,-74,5)','00000000-0000-0000-0000-000000000800',:'start_version','NaN'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now(),91,-74,5)','00000000-0000-0000-0000-000000000800',:'start_version'),'DRIVER_PAY_START_GPS_REQUIRED');
select test_error($$select start_driver_load_with_pay('00000000-0000-0000-0000-000000000800',gen_random_uuid(),9999,now(),40,-74,5)$$,'DRIVER_PAY_START_VERSION_CONFLICT');
select start_driver_load_with_pay('00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000880',:'start_version',:'captured_at',40,-74,5) as start_result \gset
select test_assert(start_driver_load_with_pay('00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000880',:'start_version',:'captured_at',40,-74,5)=:'start_result'::jsonb,'exact START retry returns same immutable origin operation');
select test_error(format('select start_driver_load_with_pay(%L,%L,%s,%L,41,-74,5)','00000000-0000-0000-0000-000000000800','00000000-0000-0000-0000-000000000880',:'start_version',:'captured_at'),'DRIVER_PAY_START_OPERATION_CONFLICT');
select test_error(format('select start_driver_load_with_pay(%L,gen_random_uuid(),%s,now(),41,-74,5)','00000000-0000-0000-0000-000000000800',:'start_version'),'DRIVER_PAY_START_OPERATION_CONFLICT');
reset role;
select test_assert((select count(*)=1 from private.driver_pay_start_origins where assignment_id=:'pending_assignment')
 and (select count(*)=1 from jobs where type='driver.pay_calculation' and payload->>'assignmentId'=:'pending_assignment')
 and (select driver_stage='en_route_to_pickup' from assignments where id=:'pending_assignment'),'START commits one origin, stage and durable job');
select test_error($$update private.driver_pay_start_origins set latitude=42$$,'immutable');
select test_assert(not has_table_privilege('authenticated','private.driver_pay_start_origins','select'),'origin not directly exposed to client');
select test_assert(worker_cron.invoke('driver_pay')=1,'eligible job wakes mocked safe transport');
set role service_role;
select claim_driver_pay_calculation('worker-first',:'pending_assignment') as first_job \gset
select test_assert((:'first_job'::jsonb->'origin'->>'latitude')::numeric=40
 and jsonb_array_length(:'first_job'::jsonb->'stops')=2,'worker receives captured GPS and ordered full route');
select test_assert(claim_driver_pay_calculation('worker-duplicate',:'pending_assignment') is null,'live lease cannot be claimed twice');
select test_assert(not finish_driver_pay_calculation((:'first_job'::jsonb->>'jobId')::uuid,'wrong-worker',100,10,'mapbox'),'other worker cannot finish lease');
select test_assert(finish_driver_pay_calculation((:'first_job'::jsonb->>'jobId')::uuid,'worker-first',null,null,null,true),'provider failure records retry without rejecting START');
select test_assert(claim_driver_pay_calculation('worker-too-soon',:'pending_assignment') is null,'retry backoff enforced');
reset role;
select test_assert((select rate_per_mile=0.7 from assignment_driver_pay_pending where assignment_id=:'pending_assignment')
 and not exists(select 1 from assignment_driver_pay where assignment_id=:'pending_assignment'),'failed provider leaves unknown pay and original rate');
update jobs set available_at=now()-interval '1 second' where id=(:'first_job'::jsonb->>'jobId')::uuid;
set role service_role;
select claim_driver_pay_calculation('worker-retry',:'pending_assignment') as second_job \gset
select test_assert(:'second_job'::jsonb->'origin'=:'first_job'::jsonb->'origin','retry never substitutes later presence');
select test_error(format('select finish_driver_pay_calculation(%L,%L,0,10,%L)',:'second_job'::jsonb->>'jobId','worker-retry','mapbox'),'DRIVER_PAY_ROUTE_RESULT_INVALID');
select test_error(format('select finish_driver_pay_calculation(%L,%L,100,-1,%L)',:'second_job'::jsonb->>'jobId','worker-retry','mapbox'),'DRIVER_PAY_ROUTE_RESULT_INVALID');
select test_error(format('select finish_driver_pay_calculation(%L,%L,%L::numeric,0,%L)',:'second_job'::jsonb->>'jobId','worker-retry','NaN','mapbox'),'DRIVER_PAY_ROUTE_RESULT_INVALID');
select test_error(format('select finish_driver_pay_calculation(%L,%L,100,0.001,%L)',:'second_job'::jsonb->>'jobId','worker-retry','mapbox'),'DRIVER_PAY_ROUTE_RESULT_INVALID');
select test_error(format('select finish_driver_pay_calculation(%L,%L,100,10,%L)',:'second_job'::jsonb->>'jobId','worker-retry','dispatcher_confirmed'),'DRIVER_PAY_ROUTE_RESULT_INVALID');
select test_assert(finish_driver_pay_calculation((:'second_job'::jsonb->>'jobId')::uuid,'worker-retry',100.25,0,'mapbox'),'routed finalization succeeds with explicit zero deadhead');
select test_assert(not finish_driver_pay_calculation((:'second_job'::jsonb->>'jobId')::uuid,'worker-retry',100.25,0,'mapbox'),'finished job cannot run twice');
reset role;
select test_assert((select amount=70.18 and rate_per_mile=0.7 and origin_latitude=40 and origin_longitude=-74
 and location_at=:'captured_at'::timestamptz from assignment_driver_pay where assignment_id=:'pending_assignment')
 and not exists(select 1 from assignment_driver_pay_pending where assignment_id=:'pending_assignment'),'server uses original frozen rate and START evidence only');
select test_assert((select count(*)=1 from audit_events where entity_id=:'pending_assignment' and action='driver.pay_calculated'),'one settled snapshot and audit');
select test_error($$update assignment_driver_pay_pending set rate_per_mile=42$$,'immutable');
select test_error($$update assignment_driver_pay set rate_per_mile=42$$,'immutable');
select test_assert((select amount=812.74 and rate_per_mile=0.65 from assignment_driver_pay where load_id='00000000-0000-0000-0000-000000000201'),'old finalized snapshot unchanged');
select test_assert(to_regprocedure('public.finalize_pending_driver_pay(uuid,numeric,numeric,text)') is null,'no staff/manual financial resolver exposed');

-- Scoped fixture helper; real production START runs under the caller's identity.
create function test_start_pay(n integer) returns jsonb language plpgsql as $$
declare target uuid:=('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid; v bigint;
begin select (value->>'version')::bigint into v from get_driver_load_rows(array[target]) value;
 return start_driver_load_with_pay(target,gen_random_uuid(),v,now(),41,-75,10); end $$;
update load_stops set sequence=4 where load_id='00000000-0000-0000-0000-000000000802' and sequence=2;
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000802','pickup',2,'Pickup 2','City','NY'),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000802','delivery',3,'Delivery 1','City','NY');
-- Failure after full route read must leave no origin/stage/job partial commit.
update load_stops set type='pickup' where load_id='00000000-0000-0000-0000-000000000803' and sequence=2;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error('select test_start_pay(803)','DRIVER_PAY_START_ROUTE_INVALID');
reset role;
select test_assert(not exists(select 1 from private.driver_pay_start_origins where load_id='00000000-0000-0000-0000-000000000803')
 and (select driver_stage='accepted' from assignments where id=(select current_assignment_id from loads where id='00000000-0000-0000-0000-000000000803')),'invalid route START rolls back capture and stage');
update load_stops set type='delivery' where load_id='00000000-0000-0000-0000-000000000803' and sequence=2;
update load_stops set status='done' where load_id='00000000-0000-0000-0000-000000000803' and sequence=1;
set role authenticated;
select test_error('select test_start_pay(803)','DRIVER_PAY_START_ROUTE_INVALID');
reset role;
update load_stops set status='pending' where load_id='00000000-0000-0000-0000-000000000803' and sequence=1;
set role authenticated;
select test_start_pay(n) from generate_series(801,808)n;
reset role;
select test_assert((select jsonb_array_length(stops)=4 and stops->1->>'address_line'='Pickup 2'
 and stops->2->>'address_line'='Delivery 1' from private.driver_pay_start_origins
 where load_id='00000000-0000-0000-0000-000000000802'),'multi-stop START delegates safely and freezes full route in order');
select current_assignment_id as changed_assignment from loads where id='00000000-0000-0000-0000-000000000806' \gset
select current_assignment_id as trash_assignment from loads where id='00000000-0000-0000-0000-000000000807' \gset
select claim_driver_pay_calculation('worker-changed',:'changed_assignment') as changed_job \gset
select claim_driver_pay_calculation('worker-trash',:'trash_assignment') as trash_job \gset
update load_stops set address_line='Changed after start' where load_id='00000000-0000-0000-0000-000000000806' and sequence=1;
select test_assert(not finish_driver_pay_calculation((:'changed_job'::jsonb->>'jobId')::uuid,'worker-changed',100,10,'mapbox'),'changed route cannot finalize against original evidence');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (trash_load('00000000-0000-0000-0000-000000000807',(select version from loads where id='00000000-0000-0000-0000-000000000807'))).version as restore_version \gset
select restore_trashed_load('00000000-0000-0000-0000-000000000807',:'restore_version','00000000-0000-0000-0000-000000000004');
reset role;
select test_assert(not finish_driver_pay_calculation((:'trash_job'::jsonb->>'jobId')::uuid,'worker-trash',100,10,'mapbox'),'trashed/restored reassignment cannot finalize previous driver');
select test_assert(exists(select 1 from assignment_driver_pay_pending where assignment_id=:'trash_assignment')
 and not exists(select 1 from assignment_driver_pay_pending where assignment_id=(select current_assignment_id from loads where id='00000000-0000-0000-0000-000000000807')),'other driver does not inherit prior rate, history retained');
select current_assignment_id as stale_assignment from loads where id='00000000-0000-0000-0000-000000000808' \gset
select claim_driver_pay_calculation('worker-stale',:'stale_assignment') as stale_job \gset
update jobs set locked_at=now()-interval '3 minutes' where id=(:'stale_job'::jsonb->>'jobId')::uuid;
select test_assert(not finish_driver_pay_calculation((:'stale_job'::jsonb->>'jobId')::uuid,'worker-stale',100,10,'mapbox'),'expired lease cannot finalize');
select test_assert(claim_driver_pay_calculation('worker-recovered',:'stale_assignment')->'origin'=:'stale_job'::jsonb->'origin','stale lease recovers same START origin');
update jobs set locked_at=now()-interval '3 minutes',attempt_count=max_attempts where id=(:'stale_job'::jsonb->>'jobId')::uuid;
select test_assert(claim_driver_pay_calculation('worker-exhausted',:'stale_assignment') is null,'retry budget does not loop forever');
select test_assert((select status='dead_letter' from jobs where id=(:'stale_job'::jsonb->>'jobId')::uuid),'exhausted job deadletters while pay remains unknown');
