reset role;
delete from driver_presence where driver_id='00000000-0000-0000-0000-000000000004';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select upsert_driver_presence(40,-80,null,null,true);
select test_assert((select latitude is null and location_captured_at is null and is_online from driver_presence where driver_id=auth.uid()),'legacy heartbeat cannot fabricate a fresh position');
select now()-interval '10 seconds' as capture_time \gset
select upsert_driver_presence(40,-80,10,5,true,:'capture_time');
select test_assert((select latitude=40 and location_captured_at=:'capture_time'::timestamptz from driver_presence where driver_id=auth.uid()),'fresh position stores capture time');
select upsert_driver_presence(null,null,null,null,true);
select upsert_driver_presence(44,-84,null,null,true,now()-interval '5 minutes');
select upsert_driver_presence(45,-85,null,null,true,now()+interval '40 seconds');
select upsert_driver_presence(46,-86,null,null,true,now()-interval '2 minutes');
select upsert_driver_presence(47,-87,null,null,true,:'capture_time');
select test_assert((select latitude=40 and location_captured_at=:'capture_time'::timestamptz from driver_presence where driver_id=auth.uid()),'heartbeats, stale/future/equal-time samples never refresh or replace GPS');
select upsert_driver_presence(null,null,null,null,false);
select test_assert((select not is_online and location_captured_at=:'capture_time'::timestamptz from driver_presence where driver_id=auth.uid()),'offline heartbeat preserves captured sample');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select upsert_driver_presence(40,-80)$$,'Driver permission required');
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Synthetic driver',null,null,false);
reset role;
select test_seed_load('00000000-0000-0000-0000-000000009800');
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,requires_document) values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009800','pickup',1,'First pickup','A','AA',false),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009800','pickup',2,'Second pickup','B','BB',false),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009800','delivery',3,'First delivery','C','CC',false),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009800','delivery',4,'Last delivery','D','DD',false);
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert((select count(*)=1 and min(pickup_address)='First pickup' and min(delivery_address)='Last delivery' from load_overview where id='00000000-0000-0000-0000-000000009800'),'2x2 stops produce one row with ordered route endpoints');
select (assign_load_directly('00000000-0000-0000-0000-000000009800','00000000-0000-0000-0000-000000000004')).id as capture_assignment \gset
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Synthetic driver',null,null,true);
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert(not exists(select 1 from loads where id='00000000-0000-0000-0000-000000009800') and can_access_load('00000000-0000-0000-0000-000000009800'),'hidden raw load remains authorized for operational contact lookup');
select now() as batch_capture \gset
select ingest_driver_location_batch(:'capture_assignment'::uuid,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'captured_at',:'batch_capture','latitude',41,'longitude',-81,'accuracy_m',10)));
select test_assert((select latitude=41 and location_captured_at=:'batch_capture'::timestamptz from driver_presence where driver_id=auth.uid()),'tracking batch preserves GPS capture timestamp');
select ingest_driver_location_batch(:'capture_assignment'::uuid,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'captured_at',:'capture_time','latitude',42,'longitude',-82,'accuracy_m',10)));
select test_assert((select latitude=41 and location_captured_at=:'batch_capture'::timestamptz from driver_presence where driver_id=auth.uid()),'older batch cannot move latest presence backwards');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(not can_access_load('00000000-0000-0000-0000-000000009800'),'unassigned driver cannot use contact lookup');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_assert(not exists(select 1 from load_overview where id='00000000-0000-0000-0000-000000009800'),'overview still enforces tenant RLS');
reset role;
select test_assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='load_overview'::regclass),'overview retains invoker permissions');
select test_assert(not has_function_privilege('anon','upsert_driver_presence(numeric,numeric,numeric,numeric,boolean,timestamptz)','execute'),'anonymous presence writes denied');

-- Trusted route quotes obey the same captured-time boundary at write AND assign.
select test_seed_load('00000000-0000-0000-0000-000000009820');
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,requires_document)
values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009820','pickup',1,'Route A','A','AA',false),
('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009820','delivery',2,'Route B','B','BB',false);
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Synthetic driver',null,0.8);
reset role;
create function test_prepare_audit_quote(captured timestamptz) returns void language sql as $$
 select prepare_driver_pay_quote('00000000-0000-0000-0000-000000009820','00000000-0000-0000-0000-000000000004',
 '00000000-0000-0000-0000-000000000001',0.8,100,10,
 (select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,latitude,longitude) order by sequence,id)
 from load_stops where load_id='00000000-0000-0000-0000-000000009820'),40,-80,captured,'mapbox');
$$;
select test_error($$select test_prepare_audit_quote(now()-interval '2 minutes')$$,'Fresh road route required');
select test_error($$select test_prepare_audit_quote(now()+interval '31 seconds')$$,'Fresh road route required');
select test_prepare_audit_quote(now());
update private.driver_pay_quotes set location_at=now()-interval '2 minutes' where load_id='00000000-0000-0000-0000-000000009820';
set role authenticated;
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000009820','00000000-0000-0000-0000-000000000004')$$,'DRIVER_PAY_ROUTE_REQUIRED');
reset role;
select test_prepare_audit_quote(now());
set role authenticated;
select (assign_load_directly('00000000-0000-0000-0000-000000009820','00000000-0000-0000-0000-000000000004')).id as fresh_pay_assignment \gset
select test_assert((select amount=88 from assignment_driver_pay where assignment_id=:'fresh_pay_assignment'),'fresh captured route can still freeze driver pay');
reset role;
