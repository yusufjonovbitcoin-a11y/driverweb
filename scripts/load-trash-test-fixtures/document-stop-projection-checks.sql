begin;
select test_seed_load('00000000-0000-0000-0000-000000000700');
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Projection driver',null,null,true);
select assign_load_directly('00000000-0000-0000-0000-000000000700','00000000-0000-0000-0000-000000000004');
reset role;
update loads set loaded_miles=123.45, driver_brief='{
 "version":1,"reviewedAt":"2026-10-07","blockingFields":[],"fields":[
 {"key":"stops.0.scheduledDate","value":"9/22/2026","quote":"Rate $5000"},
 {"key":"stops.0.timePrinted","value":"Appt 23:59"},
 {"key":"stops.0.referenceNumber","value":"SUNCD/INT/0001"},
 {"key":"stops.1.timePrinted","value":"FCFS 07:00–15:00"},
 {"key":"stops.1.note","value":"Gate 3; rate $5000"},
 {"key":"stops.2.appointmentPrinted","value":"Pay 900 USD"},
 {"key":"stops.2.referenceNumber","value":"$5000"},
 {"key":"brokerRate","value":5000},
 {"key":"stops.3.timePrinted","value":"07:00; rate 5000"}
 ]}'::jsonb where id='00000000-0000-0000-0000-000000000700';
select test_assert(private.driver_document_stop_details('{"version":1,"fields":[]}',true)='{}','unreviewed hidden');
select test_assert(private.driver_document_stop_details('{"version":1,"reviewedAt":"x","blockingFields":["address"],"fields":[]}',false)='{}','blocked hidden');
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select value as projected from get_driver_load_rows(array['00000000-0000-0000-0000-000000000700'::uuid]) value \gset
select test_assert(:'projected'::jsonb#>>'{driver_stop_details,stops.0.scheduledDate}'='9/22/2026','printed date persists');
select test_assert(:'projected'::jsonb#>>'{driver_stop_details,stops.0.timePrinted}'='Appt 23:59','printed clock persists');
select test_assert(:'projected'::jsonb#>>'{driver_stop_details,stops.1.timePrinted}'='FCFS 07:00–15:00','window stays exact');
select test_assert(:'projected'::jsonb#>>'{driver_stop_details,stops.0.referenceNumber}'='SUNCD/INT/0001','reference persists');
select test_assert(:'projected'::jsonb->>'loaded_miles'='123.45','saved PDF miles retained');
select test_assert(:'projected'::jsonb->'driver_brief'='null','raw source stays hidden');
select test_assert(not (:'projected'::jsonb->'driver_stop_details') ? 'stops.1.note','free text excluded when private');
select test_assert(:'projected' not like '%5000%' and :'projected' not like '%900 USD%','quotes and disguised commercial fields excluded');
select test_error($$select private.driver_document_stop_details('{}',false)$$,'permission denied');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_pay_privacy('00000000-0000-0000-0000-000000000004','Projection driver',null,null,false);
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert((select value#>>'{driver_stop_details,stops.1.note}'='Gate 3; rate $5000'
 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000700'::uuid]) value),'non-hidden instructions preserved');
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error($$select * from get_driver_load_rows('{}')$$,'Active driver required');
rollback;
begin read only;
set local role authenticated;
set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select count(*)=1 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000201'::uuid])),'projection works in read-only transaction');
rollback;
