-- Per-load manually recorded amounts; null means not entered, never zero.
create table public.load_accounting (
  load_id uuid primary key references public.loads(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  additional_income numeric(12,2) check (additional_income >= 0),
  driver_pay numeric(12,2) check (driver_pay >= 0),
  fuel_cost numeric(12,2) check (fuel_cost >= 0),
  toll_cost numeric(12,2) check (toll_cost >= 0),
  other_cost numeric(12,2) check (other_cost >= 0),
  broker_paid numeric(12,2) check (broker_paid >= 0),
  notes text not null default '' check (length(notes) <= 2000),
  version integer not null default 1,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index load_accounting_company_idx on public.load_accounting(company_id);
alter table public.load_accounting enable row level security;
revoke all on public.load_accounting from anon, authenticated;
grant select on public.load_accounting to authenticated;
create policy load_accounting_staff_read on public.load_accounting for select to authenticated
using (company_id = (select public.current_company_id())
  and (select public.current_app_role()) in ('company_admin','dispatcher')
  and public.can_access_load(load_id));

-- Definer is required so clients have no direct financial-write/audit privileges.
-- Every write derives the tenant from the authenticated active staff member.
create function public.save_load_accounting(target_load_id uuid, expected_version integer, amounts jsonb, note_text text default '')
returns public.load_accounting
language plpgsql security definer set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.loads;
  previous public.load_accounting;
  saved public.load_accounting;
  field_name text;
begin
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'ACCOUNTING_PERMISSION';
  end if;
  select * into target from public.loads where id=target_load_id and company_id=actor.company_id for update;
  if target.id is null then raise exception 'ACCOUNTING_NOT_FOUND'; end if;
  if target.status = 'cancelled' then raise exception 'ACCOUNTING_CANCELLED'; end if;
  select * into previous from public.load_accounting where load_id=target.id;
  if expected_version is distinct from coalesce(previous.version,0) then raise exception 'ACCOUNTING_CONFLICT'; end if;
  if jsonb_typeof(amounts) is distinct from 'object' or note_text is null or length(note_text)>2000 then
    raise exception 'ACCOUNTING_INVALID';
  end if;
  foreach field_name in array array['additional_income','driver_pay','fuel_cost','toll_cost','other_cost','broker_paid'] loop
    if not amounts ? field_name then raise exception 'ACCOUNTING_INVALID'; end if;
    if amounts->field_name <> 'null'::jsonb and
      (jsonb_typeof(amounts->field_name) not in ('number','string')
       or (amounts->>field_name) !~ '^\d{1,10}(\.\d{1,2})?$') then raise exception 'ACCOUNTING_INVALID'; end if;
  end loop;
  insert into public.load_accounting(load_id,company_id,additional_income,driver_pay,fuel_cost,toll_cost,other_cost,broker_paid,notes,updated_by)
  values(target.id,actor.company_id,(amounts->>'additional_income')::numeric,(amounts->>'driver_pay')::numeric,
    (amounts->>'fuel_cost')::numeric,(amounts->>'toll_cost')::numeric,(amounts->>'other_cost')::numeric,
    (amounts->>'broker_paid')::numeric,btrim(note_text),actor.id)
  on conflict(load_id) do update set additional_income=excluded.additional_income,driver_pay=excluded.driver_pay,
    fuel_cost=excluded.fuel_cost,toll_cost=excluded.toll_cost,other_cost=excluded.other_cost,broker_paid=excluded.broker_paid,
    notes=excluded.notes,updated_by=actor.id,updated_at=now(),version=load_accounting.version+1
  returning * into saved;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
    values(actor.company_id,actor.id,'load.accounting_updated','load',target.id,
      case when previous.load_id is null then null else to_jsonb(previous) end,to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function public.save_load_accounting(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.save_load_accounting(uuid,integer,jsonb,text) to authenticated;

-- Aggregate before pagination: totals cover the complete filtered company set.
create function public.get_company_trip_analytics(
  requested_group text default 'all', search_text text default '',
  date_from date default null, date_to date default null,
  page_number integer default 1, page_size integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result jsonb;
begin
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
      case when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'brokerRate' then null
        else coalesce(s.broker_rate,l.broker_rate) end as contract_amount,
      case when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'loadedMiles' then null
        else coalesce(s.loaded_miles,l.loaded_miles) end as loaded_miles,
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
      'balancedRows',count(balance),'loadedMiles',case when count(*)=0 then 0 else sum(loaded_miles) end,
      'rpm',sum(contract_amount) filter(where loaded_miles>0)/nullif(sum(loaded_miles) filter(where contract_amount is not null and loaded_miles>0),0),
      'outstanding',case when count(*)=0 then 0 else sum(outstanding) end,'paymentRows',count(outstanding))
      from calculated where trip_group<>'cancelled'),
    'rows',coalesce((select jsonb_agg(to_jsonb(n)-'row_number' order by n.row_number) from numbered n
      where n.row_number>(page_number-1)*page_size and n.row_number<=page_number*page_size),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_company_trip_analytics(text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_company_trip_analytics(text,text,date,date,integer,integer) to authenticated;
