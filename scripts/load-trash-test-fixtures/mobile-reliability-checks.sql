-- Four-stop route on the restored fixed-pay assignment. No production data.
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select save_driver_instructions('00000000-0000-0000-0000-000000000202',
  (select version from loads where id='00000000-0000-0000-0000-000000000202'),'Use dock 4. Send loaded photos.');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select value->>'special_instructions'='Use dock 4. Send loaded photos.'
  from get_driver_load_rows(array['00000000-0000-0000-0000-000000000202'::uuid])value),'fixed-pay driver receives approved operational instructions');
select test_error($$select save_driver_instructions('00000000-0000-0000-0000-000000000202',1,'forged')$$,'Staff permission');
select test_assert(get_driver_analytics_in_zone(now()-interval '30 days',now(),'America/Chicago') is not null,'analytics accepts configured US time zone');
select test_error($$select get_driver_analytics_in_zone(now(),now(),'bad/zone')$$,'Unsupported report');
reset role;
update load_stops set requires_document=false where load_id='00000000-0000-0000-0000-000000000202';
create function test_advance(stage text, op uuid default gen_random_uuid()) returns jsonb
language plpgsql as $$ declare v bigint; begin
  select (value->>'version')::bigint into v from get_driver_load_rows(array['00000000-0000-0000-0000-000000000202'::uuid]) value;
  return advance_driver_stage('00000000-0000-0000-0000-000000000202',stage,op,v);
end $$;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error($$select advance_driver_route('00000000-0000-0000-0000-000000000202','en_route_to_pickup',gen_random_uuid(),1)$$,'no longer assigned');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(test_advance('en_route_to_pickup','00000000-0000-0000-0000-000000000301')->>'stage'='en_route_to_pickup','multi-stop start via legacy endpoint');
select test_assert(test_advance('en_route_to_pickup','00000000-0000-0000-0000-000000000301')->>'stage'='en_route_to_pickup','multi-stop retry is idempotent');
select test_error($$select test_advance('completed')$$,'Complete every stop');
select test_advance('arrived_at_pickup');
select test_assert(test_advance('picked_up')->>'stage'='en_route_to_pickup','first pickup routes to second pickup');
select test_advance('arrived_at_pickup');
select test_assert(test_advance('picked_up')->>'stage'='in_transit','all pickups route to first delivery');
select test_advance('arrived_at_delivery');
reset role;
update load_stops set requires_document=true where load_id='00000000-0000-0000-0000-000000000202' and sequence=3;
set role authenticated;
select test_error($$select test_advance('delivered')$$,'Required stop document');
reset role;
update load_stops set requires_document=false where load_id='00000000-0000-0000-0000-000000000202' and sequence=3;
set role authenticated;
select test_assert(test_advance('delivered')->>'stage'='in_transit','first delivery does not finish route');
select test_error($$select test_advance('completed')$$,'Complete every stop');
select test_advance('arrived_at_delivery');
select test_assert(test_advance('delivered')->>'stage'='delivered','last delivery ends route');
select test_assert(test_advance('completed')->>'stage'='completed','only fully completed route can finish');
reset role;
select test_assert((select count(*)=4 from load_stops where load_id='00000000-0000-0000-0000-000000000202' and status='done'),'all four stops persisted');
