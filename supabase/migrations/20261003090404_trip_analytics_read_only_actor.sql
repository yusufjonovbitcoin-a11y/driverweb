-- PostgREST runs STABLE RPCs in read-only transactions. Keep this actor lookup
-- lock-free; current_profile() intentionally locks profiles for mutation RPCs.
create or replace function public.get_company_trip_analytics(
  requested_group text default 'all', search_text text default '',
  date_from date default null, date_to date default null,
  page_number integer default 1, page_size integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path = public
as $$
declare
  actor public.profiles;
  result jsonb;
begin
  select * into actor
  from public.profiles p
  where p.id = (select auth.uid());

  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'ACCOUNTING_PERMISSION';
  end if;
  if requested_group is null or requested_group not in ('all','active','completed','planned','cancelled')
    or page_number is null or page_number < 1 or page_number > 100000
    or page_size is null or page_size < 1 or page_size > 100
    or (date_from is not null and date_to is not null and date_from > date_to) then
    raise exception 'ANALYTICS_INVALID_FILTER';
  end if;
  with base as (
    select l.id,l.load_number,l.status::text as status,l.broker_name,
      case when l.status='completed' then 'completed' when l.status='cancelled' then 'cancelled'
        when l.status in ('assigned','in_progress','delivered','dispute') then 'active' else 'planned' end as trip_group,
      a.driver_id,p.full_name as driver_name,a.driver_stage,a.assigned_at,
      case when l.status='completed' and a.status='completed' then a.ended_at end as completed_at,
      case when l.status='completed' then coalesce(a.ended_at,l.updated_at)
        else coalesce(a.assigned_at,l.created_at) end as trip_date,
      pickup.city as pickup_city,pickup.region as pickup_region,
      delivery.city as delivery_city,delivery.region as delivery_region,
      case when s.id is not null then s.broker_rate
        when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'brokerRate' then null
        else l.broker_rate end as contract_amount,
      case when s.id is not null then s.loaded_miles
        when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'loadedMiles' then null
        else l.loaded_miles end as loaded_miles,
      case when s.id is null then 'load' else 'accepted_snapshot' end as price_source,
      l.broker_rate as current_contract_amount,
      coalesce(a.requires_reconfirmation,false) as requires_reconfirmation,
      f.additional_income,f.driver_pay,f.fuel_cost,f.toll_cost,f.other_cost,f.broker_paid,
      f.notes,coalesce(f.version,0) as accounting_version,f.updated_at as accounting_updated_at,
      exists(select 1 from public.documents d where d.load_id=l.id and d.company_id=l.company_id
        and d.document_type='receipt' and d.current_version_id is not null) as has_receipt
    from public.loads l
    left join public.assignments a on a.id=l.current_assignment_id and a.company_id=l.company_id
    left join public.profiles p on p.id=a.driver_id and p.company_id=l.company_id
    left join public.load_price_snapshots s on s.id=a.accepted_price_snapshot_id and s.load_id=l.id and s.company_id=l.company_id
    left join public.load_accounting f on f.load_id=l.id and f.company_id=l.company_id
    left join lateral(select city,region from public.load_stops where load_id=l.id and company_id=l.company_id and type='pickup' order by sequence limit 1) pickup on true
    left join lateral(select city,region from public.load_stops where load_id=l.id and company_id=l.company_id and type='delivery' order by sequence desc limit 1) delivery on true
    where l.company_id=actor.company_id
  ), searched as (
    select * from base where
      (coalesce(btrim(search_text),'')='' or position(lower(btrim(search_text)) in lower(concat_ws(' ',load_number,broker_name,driver_name,pickup_city,pickup_region,delivery_city,delivery_region)))>0)
      and (date_from is null or (trip_date at time zone 'UTC')::date >= date_from)
      and (date_to is null or (trip_date at time zone 'UTC')::date <= date_to)
  ), filtered as (
    select *,contract_amount+additional_income as revenue,
      driver_pay+fuel_cost+toll_cost+other_cost as costs,
      case when num_nonnulls(driver_pay,fuel_cost,toll_cost,other_cost)>0 then
        coalesce(driver_pay,0)+coalesce(fuel_cost,0)+coalesce(toll_cost,0)+coalesce(other_cost,0) end as recorded_costs
    from searched where requested_group='all' or trip_group=requested_group
  ), calculated as (
    select *,revenue-costs as balance,revenue-broker_paid as outstanding,
      case when loaded_miles>0 then contract_amount/loaded_miles end as rpm
    from filtered
  ), numbered as (
    select *,row_number() over(order by trip_date desc,id desc) as row_number from calculated
  )
  select jsonb_build_object(
    'total',(select count(*) from calculated),
    'page',page_number,'pageSize',page_size,
    'counts',jsonb_build_object('all',(select count(*) from searched),
      'active',(select count(*) from searched where trip_group='active'),
      'completed',(select count(*) from searched where trip_group='completed'),
      'planned',(select count(*) from searched where trip_group='planned'),
      'cancelled',(select count(*) from searched where trip_group='cancelled')),
    'summary',(select jsonb_build_object('count',count(*),'knownRates',count(contract_amount),
      'contractAmount',case when count(*)=0 then 0 else sum(contract_amount) end,
      'recordedCosts',case when count(*)=0 then 0 else sum(recorded_costs) end,
      'costRows',count(recorded_costs),'balance',case when count(*)=0 then 0 else sum(balance) end,
      'balancedRows',count(balance),'fuelCost',sum(fuel_cost),'fuelRows',count(fuel_cost),'knownMiles',count(loaded_miles),'loadedMiles',case when count(*)=0 then 0 else sum(loaded_miles) end,
      'rpm',sum(contract_amount) filter(where loaded_miles>0)/nullif(sum(loaded_miles) filter(where contract_amount is not null and loaded_miles>0),0),
      'outstanding',case when count(*)=0 then 0 else sum(outstanding) end,'paymentRows',count(outstanding))
      from calculated where trip_group<>'cancelled'),
    'dashboard',jsonb_build_object(
      'monthly',coalesce((select jsonb_agg(to_jsonb(m) order by month) from (
        select to_char(trip_date at time zone 'UTC','YYYY-MM') as month,
          sum(loaded_miles) as miles,sum(contract_amount) as amount,sum(fuel_cost) as fuel,
          count(*) as count,count(loaded_miles) as known_miles,count(contract_amount) as known_rates,count(fuel_cost) as known_fuel
        from calculated where trip_group<>'cancelled'
        group by 1 order by 1 desc limit 6
      ) m),'[]'::jsonb),
      'lanes',coalesce((select jsonb_agg(to_jsonb(r) order by miles desc nulls last,origin,destination) from (
        select coalesce(nullif(concat_ws(', ',pickup_city,pickup_region),''),'—') as origin,
          coalesce(nullif(concat_ws(', ',delivery_city,delivery_region),''),'—') as destination,
          sum(loaded_miles) as miles,count(*) as count
        from calculated where trip_group<>'cancelled'
        group by 1,2 order by miles desc nulls last,1,2 limit 5
      ) r),'[]'::jsonb),
      'expenses',(select jsonb_build_object('driver_pay',sum(driver_pay),'fuel_cost',sum(fuel_cost),
        'toll_cost',sum(toll_cost),'other_cost',sum(other_cost)) from calculated where trip_group<>'cancelled')
    ),
    'rows',coalesce((select jsonb_agg(to_jsonb(n)-'row_number' order by n.row_number) from numbered n
      where n.row_number>(page_number-1)*page_size and n.row_number<=page_number*page_size),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_company_trip_analytics(text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_company_trip_analytics(text,text,date,date,integer,integer) to authenticated;
