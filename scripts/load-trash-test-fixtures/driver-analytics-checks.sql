create function test_uuid(n integer) returns uuid language sql immutable as $$
  select ('90000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
create function test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if;
raise notice 'PASS: %',label; end $$;
create function test_error(command text,expected text) returns void language plpgsql as $$
declare actual text;
begin begin execute command; exception when others then actual:=sqlerrm; end;
if actual is null or position(expected in actual)=0 then raise exception 'FAILED expected %, received %',expected,actual; end if;
raise notice 'PASS: rejected with %',expected; end $$;
insert into auth.users select test_uuid(n) from generate_series(10,13)n;
insert into companies(id,name) values(test_uuid(1),'Test company'),(test_uuid(2),'Other company');
insert into profiles(id,company_id,role,full_name,email) values
(test_uuid(10),test_uuid(1),'company_admin','Admin','admin@analytics.test'),
(test_uuid(11),test_uuid(1),'driver','Other driver','other@analytics.test'),
(test_uuid(12),test_uuid(1),'driver','Driver','driver@analytics.test'),
(test_uuid(13),test_uuid(2),'driver','Foreign driver','foreign@analytics.test');
insert into loads(id,company_id,owner_dispatcher_id,load_number,status,broker_rate,loaded_miles)
select test_uuid(100+n),test_uuid(1),test_uuid(10),'ANALYTICS-'||n,'completed',100,100
from generate_series(1,10)n;
insert into assignments(id,company_id,load_id,driver_id,assigned_by,status,assigned_at,ended_at)
select test_uuid(200+n),test_uuid(1),test_uuid(100+n),test_uuid(case when n=10 then 11 else 12 end),
  test_uuid(10),'completed','2026-10-07T06:00:00Z','2026-10-07T18:00:00Z'
from generate_series(1,10)n;
insert into load_stops(id,company_id,load_id,type,sequence,address_line,city,region,appointment_to)
select test_uuid(300+n),test_uuid(1),test_uuid(100+n),'delivery',2,'Test street','Test city','NJ',
  case when n=4 then null else '2026-10-07T15:00:00Z'::timestamptz end
from generate_series(1,10)n;
insert into load_stops(id,company_id,load_id,type,sequence,address_line,city,region,appointment_to)
select test_uuid(400+n),test_uuid(1),test_uuid(100+n),'delivery',1,'First stop','Test city','NJ','2026-10-07T13:00:00Z'
from unnest(array[5,7])n;
-- Frozen pay is deliberately different from the broker revenue.
insert into assignment_driver_pay(assignment_id,load_id,driver_id,company_id,rate_per_mile,loaded_miles,deadhead_miles,
 route_fingerprint,origin_latitude,origin_longitude,location_at,provider)
values(test_uuid(201),test_uuid(101),test_uuid(12),test_uuid(1),0.30,80,20,'fixture',40,-74,'2026-10-07T06:00:00Z','mapbox');

create function test_arrival(n integer,at_time timestamptz,kind text default 'advance_driver_stage',
  stop_id uuid default null, assignment_id uuid default null, actor_id uuid default null,
  outcome operation_status default 'accepted') returns void language sql as $$
insert into client_operations(operation_id,company_id,actor_id,load_id,command_type,payload,occurred_at,received_at,status,result)
values(gen_random_uuid(),test_uuid(1),coalesce(actor_id,test_uuid(12)),test_uuid(100+n),kind,
 case when kind='transition_stop' then jsonb_build_object('nextStatus','arrived')
 else jsonb_build_object('nextStage','arrived_at_delivery') end,
 at_time,at_time+interval '1 minute',outcome,
 case when kind='transition_stop' then jsonb_build_object('stopId',stop_id,'status','arrived')
 else jsonb_strip_nulls(jsonb_build_object('assignmentId',coalesce(assignment_id,test_uuid(200+n)),
 'stopId',stop_id,'stage','arrived_at_delivery')) end)
$$;
select test_arrival(1,'2026-10-07T14:00:00Z','advance_driver_stage',test_uuid(301));
select test_arrival(1,'2026-10-07T16:00:00Z','advance_driver_stage',test_uuid(301)); -- Retry must not make arrival late.
select test_arrival(2,'2026-10-07T16:00:00Z','advance_driver_stage',test_uuid(302));
select test_arrival(4,'2026-10-07T14:00:00Z','advance_driver_stage',test_uuid(304)); -- Unscheduled.
select test_arrival(5,'2026-10-07T12:00:00Z','advance_driver_stage',test_uuid(405)); -- First delivery is early.
select test_arrival(5,'2026-10-07T16:00:00Z','advance_driver_stage',test_uuid(305)); -- Final delivery is late.
select test_arrival(6,'2026-10-07T14:00:00Z'); -- Legacy single-delivery result has no stop ID.
select test_arrival(7,'2026-10-07T14:00:00Z'); -- Same legacy result is ambiguous with two deliveries.
select test_arrival(8,'2026-10-07T14:00:00Z','transition_stop',test_uuid(308));
-- None of these may supply missing evidence for trip 9.
select test_arrival(9,'2026-10-07T14:00:00Z','advance_driver_stage',test_uuid(309),test_uuid(209),test_uuid(11));
select test_arrival(9,'2026-10-07T14:00:00Z','advance_driver_stage',test_uuid(309),test_uuid(209),test_uuid(12),'rejected');
select test_arrival(9,'2026-10-07T14:00:00Z','advance_driver_stage',test_uuid(309),test_uuid(208));
select test_arrival(9,'2026-10-07T14:00:00Z','advance_driver_stage',test_uuid(308));
select test_arrival(9,'2026-10-07T05:00:00Z','transition_stop',test_uuid(309)); -- Previous assignment period.

-- ASSERTIONS AFTER MIGRATION
set role authenticated;
set "request.jwt.claim.sub"='90000000-0000-0000-0000-000000000012';
select get_driver_analytics_in_zone('2026-10-07T00:00:00Z','2026-10-08T00:00:00Z','America/New_York') as report \gset
select test_assert((:'report'::jsonb->>'scheduledCount')::int=5,'only five trips have measurable scheduled arrivals');
select test_assert((:'report'::jsonb->>'onTimeCount')::int=3,'arrival, legacy and transition events measure on-time trips despite late completion');
select test_assert((:'report'::jsonb->>'unmeasuredScheduledCount')::int=3,'absent, ambiguous and misattributed evidence stays unknown');
select test_assert((:'report'::jsonb->>'completedCount')::int=9,'other drivers never enter totals');
select test_assert((:'report'::jsonb->>'grossRevenue')::numeric=830,'driver pay snapshot and broker totals are unchanged');
select test_assert((:'report'::jsonb->>'loadedMiles')::numeric=880 and (:'report'::jsonb->>'deadheadMiles')::numeric=20,'multiple events/stops never multiply mileage');
select test_assert((:'report'::jsonb#>>'{daily,0,date}')::timestamptz='2026-10-07T00:00:00-04','daily bucket uses report zone');
select test_assert(not has_function_privilege('anon','get_driver_analytics(timestamptz,timestamptz)','execute'),'anonymous access remains revoked');
set "request.jwt.claim.sub"='90000000-0000-0000-0000-000000000013';
select test_assert((get_driver_analytics(null,'2026-10-08')->>'completedCount')::int=0,'other company cannot access trips');
set "request.jwt.claim.sub"='90000000-0000-0000-0000-000000000010';
select test_error($$select get_driver_analytics(null,'2026-10-08')$$,'Driver permission required');
reset role;
insert into driver_pay_settings(driver_id,company_id,updated_by,hide_rate_con)
values(test_uuid(12),test_uuid(1),test_uuid(10),true);
set role authenticated;
set "request.jwt.claim.sub"='90000000-0000-0000-0000-000000000012';
select test_assert((get_driver_analytics(null,'2026-10-08')->>'grossRevenue')::numeric=30,'broker privacy remains redacted while driver pay is visible');
reset role;
update profiles set status='suspended' where id=test_uuid(12);
set role authenticated;
select test_error($$select get_driver_analytics(null,'2026-10-08')$$,'Driver permission required');
reset role;
