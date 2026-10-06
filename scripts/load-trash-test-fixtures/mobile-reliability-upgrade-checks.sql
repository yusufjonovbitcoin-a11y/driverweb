reset role;
select test_assert((select count(*)=4 from assignments where driver_stage='en_route_to_pickup'
  and load_id in ('00000000-0000-0000-0000-000000000410','00000000-0000-0000-0000-000000000411',
    '00000000-0000-0000-0000-000000000413','00000000-0000-0000-0000-000000000416')),
  'legacy picked-up/in-transit/arrival stages reconcile to unfinished pickup');
select test_assert(not exists(select 1 from test_upgrade_stops_before old join load_stops s using(id)
  where old.status<>s.status or old.version<>s.version),'upgrade preserves all stop evidence and progress');
select test_assert((select driver_stage='completed' and status='completed' from assignments
  where load_id='00000000-0000-0000-0000-000000000414'),'upgrade preserves historical completed assignment');
select test_assert((select count(*)=5 from audit_events where action='assignment.route_reconciled'),
  'each reconciled active assignment has an audit trail');
create function test_route_advance(target uuid, stage text, op uuid default gen_random_uuid()) returns jsonb
language plpgsql as $$ declare v bigint; begin
  select (value->>'version')::bigint into v from get_driver_load_rows(array[target]) value;
  return advance_driver_route(target,stage,op,v);
end $$;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error($$select advance_driver_route('00000000-0000-0000-0000-000000000410','arrived_at_pickup',gen_random_uuid(),null)$$,'Load changed');
select test_error($$select advance_driver_route('00000000-0000-0000-0000-000000000410','arrived_at_pickup',null,1)$$,'Operation ID');
select test_assert(test_route_advance('00000000-0000-0000-0000-000000000410','arrived_at_pickup')->>'stage'='arrived_at_pickup',
  'legacy picked-up route resumes at unfinished pickup');
select test_assert(test_route_advance('00000000-0000-0000-0000-000000000412','arrived_at_delivery')->>'stage'='arrived_at_delivery',
  'optional skipped stop does not block next delivery');
select test_assert(test_route_advance('00000000-0000-0000-0000-000000000413','arrived_at_pickup')->>'stage'='arrived_at_pickup',
  'required skipped stop can be revisited');
select test_error($$select test_route_advance('00000000-0000-0000-0000-000000000413','picked_up')$$,'Required stop document');
select test_route_advance('00000000-0000-0000-0000-000000000411','arrived_at_pickup','00000000-0000-0000-0000-000000000441');
select test_error($$select test_route_advance('00000000-0000-0000-0000-000000000411','picked_up','00000000-0000-0000-0000-000000000441')$$,'another action');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error($$select advance_driver_route('00000000-0000-0000-0000-000000000410','arrived_at_pickup',gen_random_uuid(),1)$$,'no longer assigned');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select advance_driver_route('00000000-0000-0000-0000-000000000410','arrived_at_pickup',gen_random_uuid(),1)$$,'Active driver');
reset role;
select test_assert(not has_function_privilege('authenticated','private.reconcile_driver_route(uuid)','execute'),
  'driver cannot invoke internal reconciliation directly');
create function test_staff_stop(target uuid, stop_sequence integer, next_stop_status stop_status) returns jsonb
language plpgsql as $$ declare stop_key uuid; v bigint; begin
  select version into v from loads where id=target;
  select id into stop_key from load_stops where load_id=target and sequence=stop_sequence;
  return transition_stop(stop_key,next_stop_status,gen_random_uuid(),v);
end $$;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_staff_stop('00000000-0000-0000-0000-000000000416',2,'skipped');
select test_assert((select driver_stage='in_transit' from assignments where load_id='00000000-0000-0000-0000-000000000416'),
  'staff skipping optional pickup advances assignment to delivery');
select test_staff_stop('00000000-0000-0000-0000-000000000416',3,'arrived');
select test_assert((select driver_stage='arrived_at_delivery' from assignments where load_id='00000000-0000-0000-0000-000000000416'),
  'staff arrival updates driver stage');
select test_staff_stop('00000000-0000-0000-0000-000000000416',3,'done');
select test_assert((select l.status='in_progress' and a.driver_stage='in_transit' from loads l join assignments a on a.id=l.current_assignment_id
  where l.id='00000000-0000-0000-0000-000000000416'),'staff first delivery never prematurely finishes multi-stop load');
select test_staff_stop('00000000-0000-0000-0000-000000000416',4,'arrived');
select test_staff_stop('00000000-0000-0000-0000-000000000416',4,'done');
select test_assert((select l.status='delivered' and a.driver_stage='delivered' from loads l join assignments a on a.id=l.current_assignment_id
  where l.id='00000000-0000-0000-0000-000000000416'),'staff last delivery updates final driver stage');
reset role;
insert into client_operations(operation_id,company_id,actor_id,load_id,command_type,occurred_at,status,payload,result)
values('00000000-0000-0000-0000-000000000442','00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000411','advance_driver_stage',now(),'accepted',
  '{"nextStage":"arrived_at_pickup"}','{"assignmentId":"00000000-0000-0000-0000-000000000499"}');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error($$select test_route_advance('00000000-0000-0000-0000-000000000411','arrived_at_pickup','00000000-0000-0000-0000-000000000442')$$,'another action or assignment');
reset role;
