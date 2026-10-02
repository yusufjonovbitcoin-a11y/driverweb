-- Run as postgres against the linked schema. Every fixture/write is rolled back.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('72000000-0000-0000-0000-000000000001','authenticated','authenticated','analytics-admin@test.local',now(),now()),
('72000000-0000-0000-0000-000000000002','authenticated','authenticated','analytics-driver@test.local',now(),now()),
('72000000-0000-0000-0000-000000000003','authenticated','authenticated','analytics-foreign@test.local',now(),now());
insert into public.companies(id,name) values
('a7200000-0000-0000-0000-000000000001','Analytics test'),
('a7200000-0000-0000-0000-000000000002','Analytics foreign');
insert into public.profiles(id,company_id,role,full_name,email) values
('72000000-0000-0000-0000-000000000001','a7200000-0000-0000-0000-000000000001','company_admin','Analytics admin','analytics-admin@test.local'),
('72000000-0000-0000-0000-000000000002','a7200000-0000-0000-0000-000000000001','driver','Analytics driver','analytics-driver@test.local'),
('72000000-0000-0000-0000-000000000003','a7200000-0000-0000-0000-000000000002','company_admin','Foreign admin','analytics-foreign@test.local');
insert into public.loads(id,company_id,owner_dispatcher_id,load_number,status,broker_rate,loaded_miles,driver_brief) values
('b7200000-0000-0000-0000-000000000001','a7200000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','ANALYTICS-A','assigned',1000,500,null),
('b7200000-0000-0000-0000-000000000002','a7200000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','ANALYTICS-B','completed',700,350,null),
('b7200000-0000-0000-0000-000000000003','a7200000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','ANALYTICS-C','cancelled',9999,100,null),
('b7200000-0000-0000-0000-000000000004','a7200000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','ANALYTICS-D','review',0,0,'{"unknownFields":["brokerRate","loadedMiles"]}'),
('b7200000-0000-0000-0000-000000000005','a7200000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000003','FOREIGN','assigned',99999,100,null);
insert into public.load_price_snapshots(id,company_id,load_id,broker_rate,loaded_miles,loaded_rpm,created_by) values
('c7200000-0000-0000-0000-000000000001','a7200000-0000-0000-0000-000000000001','b7200000-0000-0000-0000-000000000001',900,450,2,'72000000-0000-0000-0000-000000000001');
insert into public.assignments(id,company_id,load_id,driver_id,assigned_by,accepted_price_snapshot_id) values
('d7200000-0000-0000-0000-000000000001','a7200000-0000-0000-0000-000000000001','b7200000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','c7200000-0000-0000-0000-000000000001');
update public.loads set current_assignment_id='d7200000-0000-0000-0000-000000000001' where id='b7200000-0000-0000-0000-000000000001';
-- A later incomplete draft must not erase the accepted price from accounting.
update public.loads set driver_brief='{"unknownFields":["brokerRate","loadedMiles"]}' where id='b7200000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub"='72000000-0000-0000-0000-000000000001';
do $test$
declare
  result jsonb;
  saved public.load_accounting;
  amounts jsonb := '{"additional_income":"100.00","driver_pay":"300.00","fuel_cost":"0.10","toll_cost":"0.20","other_cost":"0.00","broker_paid":"500.00"}';
  bad text;
begin
  result := public.get_company_trip_analytics();
  if result->>'total' <> '4' then raise exception 'TEST tenant total'; end if;
  if result->'counts' <> '{"all":4,"active":1,"completed":1,"planned":1,"cancelled":1}'::jsonb then raise exception 'TEST status grouping'; end if;
  if (result#>>'{summary,contractAmount}')::numeric <> 1600 then raise exception 'TEST accepted snapshot and cancelled exclusion'; end if;
  if result#>>'{summary,balance}' is not null then raise exception 'TEST unknown balance'; end if;
  if result#>>'{summary,knownRates}' <> '2' then raise exception 'TEST unknown imported rates'; end if;
  if jsonb_array_length(public.get_company_trip_analytics(page_size=>1)->'rows') <> 1 then raise exception 'TEST pagination'; end if;
  if public.get_company_trip_analytics(page_size=>1,page_number=>2)->'summary' <> result->'summary' then raise exception 'TEST totals before pagination'; end if;
  if public.get_company_trip_analytics(page_size=>1,page_number=>2)->'dashboard' <> result->'dashboard' then raise exception 'TEST dashboard before pagination'; end if;
  if (select sum((m->>'amount')::numeric) from jsonb_array_elements(result#>'{dashboard,monthly}') m) <> 1600 then raise exception 'TEST chart excludes cancelled and foreign loads'; end if;
  if result#>>'{dashboard,expenses,fuel_cost}' is not null then raise exception 'TEST unknown fuel is not zero'; end if;
  if public.get_company_trip_analytics(search_text=>'ANALYTICS-B')->>'total' <> '1' then raise exception 'TEST search'; end if;
  if public.get_company_trip_analytics(date_to=>'2000-01-01')->>'total' <> '0' then raise exception 'TEST dates'; end if;

  saved := public.save_load_accounting('b7200000-0000-0000-0000-000000000001',0,amounts,' First entry ');
  if saved.version <> 1 or saved.notes <> 'First entry' or saved.company_id <> 'a7200000-0000-0000-0000-000000000001' then raise exception 'TEST saved row'; end if;
  result := public.get_company_trip_analytics('active');
  if (result#>>'{rows,0,balance}')::numeric <> 699.70 then raise exception 'TEST exact decimal balance'; end if;
  if (result#>>'{rows,0,outstanding}')::numeric <> 500 then raise exception 'TEST receivable'; end if;
  if (result#>>'{rows,0,costs}')::numeric <> 300.30 then raise exception 'TEST expenses'; end if;
  if (result#>>'{summary,fuelCost}')::numeric <> .10 then raise exception 'TEST dashboard fuel'; end if;
  if (result#>>'{dashboard,expenses,driver_pay}')::numeric <> 300 then raise exception 'TEST expense breakdown'; end if;
  begin
    perform public.save_load_accounting('b7200000-0000-0000-0000-000000000001',0,amounts);
    raise exception 'TEST stale overwrite allowed';
  exception when others then if sqlerrm <> 'ACCOUNTING_CONFLICT' then raise; end if; end;
  foreach bad in array array['-1','0.001','10000000000','NaN'] loop
    begin
      perform public.save_load_accounting('b7200000-0000-0000-0000-000000000001',1,jsonb_set(amounts,'{fuel_cost}',to_jsonb(bad)));
      raise exception 'TEST invalid amount accepted';
    exception when others then if sqlerrm <> 'ACCOUNTING_INVALID' then raise; end if; end;
  end loop;
  saved := public.save_load_accounting('b7200000-0000-0000-0000-000000000001',1,jsonb_set(amounts,'{fuel_cost}','null'));
  if saved.version <> 2 or saved.fuel_cost is not null then raise exception 'TEST version and null save'; end if;
  if public.get_company_trip_analytics('active')#>>'{rows,0,balance}' is not null then raise exception 'TEST incomplete balance'; end if;
  begin
    perform public.save_load_accounting('b7200000-0000-0000-0000-000000000005',0,amounts);
    raise exception 'TEST foreign write allowed';
  exception when others then if sqlerrm <> 'ACCOUNTING_NOT_FOUND' then raise; end if; end;
  begin
    perform public.save_load_accounting('b7200000-0000-0000-0000-000000000003',0,amounts);
    raise exception 'TEST cancelled write allowed';
  exception when others then if sqlerrm <> 'ACCOUNTING_CANCELLED' then raise; end if; end;
  begin
    update public.load_accounting set fuel_cost=999 where load_id='b7200000-0000-0000-0000-000000000001';
    raise exception 'TEST direct write allowed';
  exception when insufficient_privilege then null; end;
end;
$test$;
set local "request.jwt.claim.sub"='72000000-0000-0000-0000-000000000003';
do $test$ begin
  if public.get_company_trip_analytics()->>'total' <> '1' then raise exception 'TEST foreign reads'; end if;
  if (select count(*) from public.load_accounting) <> 0 then raise exception 'TEST foreign RLS'; end if;
end; $test$;
set local "request.jwt.claim.sub"='72000000-0000-0000-0000-000000000002';
do $test$ begin
  if (select count(*) from public.load_accounting) <> 0 then raise exception 'TEST driver RLS'; end if;
  begin
    perform public.get_company_trip_analytics();
    raise exception 'TEST driver analytics allowed';
  exception when others then if sqlerrm <> 'ACCOUNTING_PERMISSION' then raise; end if; end;
  begin
    perform public.save_load_accounting('b7200000-0000-0000-0000-000000000001',2,'{}');
    raise exception 'TEST driver write allowed';
  exception when others then if sqlerrm <> 'ACCOUNTING_PERMISSION' then raise; end if; end;
end; $test$;
reset role;
do $test$ begin
  if (select count(*) from public.audit_events where entity_id='b7200000-0000-0000-0000-000000000001' and action='load.accounting_updated') <> 2 then raise exception 'TEST audit atomicity'; end if;
  if has_function_privilege('anon','public.save_load_accounting(uuid,integer,jsonb,text)','EXECUTE') then raise exception 'TEST anonymous access'; end if;
  if not (select relrowsecurity from pg_class where oid='public.load_accounting'::regclass) then raise exception 'TEST RLS disabled'; end if;
end; $test$;
rollback;
select 'PASS: accounting calculations, persistence, audit, concurrency, filters, pagination, tenant isolation and role permissions; fixtures rolled back' as result;
