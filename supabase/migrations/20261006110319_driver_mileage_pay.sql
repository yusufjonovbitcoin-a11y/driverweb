-- Assignment-scoped compensation. No backfill: existing assignments keep their
-- original commercial terms. Deploy the compatible mobile build before enabling.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.driver_pay_settings (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  rate_per_mile numeric(10,4) check (rate_per_mile > 0 and rate_per_mile <= 100),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.driver_pay_settings enable row level security;
grant select on public.driver_pay_settings to authenticated;
create policy driver_pay_settings_read on public.driver_pay_settings for select to authenticated
using (company_id = public.current_company_id() and (driver_id = (select auth.uid()) or
  (public.is_privileged_member() and public.can_access_driver(driver_id))));

create table private.driver_pay_quotes (
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  rate_per_mile numeric(10,4) not null check (rate_per_mile > 0 and rate_per_mile <= 100),
  loaded_miles numeric(12,2) not null check (loaded_miles > 0),
  deadhead_miles numeric(12,2) not null check (deadhead_miles >= 0),
  route_fingerprint text not null,
  origin_latitude double precision not null check (origin_latitude between -90 and 90),
  origin_longitude double precision not null check (origin_longitude between -180 and 180),
  location_at timestamptz not null,
  provider text not null,
  created_at timestamptz not null default now(),
  primary key(load_id, driver_id)
);
alter table private.driver_pay_quotes enable row level security;

create table public.assignment_driver_pay (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  rate_per_mile numeric(10,4) not null check (rate_per_mile > 0 and rate_per_mile <= 100),
  loaded_miles numeric(12,2) not null check (loaded_miles > 0),
  deadhead_miles numeric(12,2) not null check (deadhead_miles >= 0),
  total_miles numeric generated always as (loaded_miles + deadhead_miles) stored,
  amount numeric generated always as (round((loaded_miles + deadhead_miles) * rate_per_mile, 2)) stored,
  currency text not null default 'USD' check (currency = 'USD'),
  distance_basis text not null default 'deadhead_and_loaded' check (distance_basis = 'deadhead_and_loaded'),
  route_fingerprint text not null,
  origin_latitude double precision not null,
  origin_longitude double precision not null,
  location_at timestamptz not null,
  provider text not null,
  created_at timestamptz not null default now()
);
create index assignment_driver_pay_driver_load_idx on public.assignment_driver_pay(driver_id, load_id);
alter table public.assignment_driver_pay enable row level security;
grant select on public.assignment_driver_pay to authenticated;
create policy assignment_driver_pay_read on public.assignment_driver_pay for select to authenticated
using (company_id = public.current_company_id() and
 (driver_id = (select auth.uid()) or (public.is_privileged_member() and public.can_access_driver(driver_id))));

create function public.update_driver_contact_and_pay(
  p_driver_id uuid, p_full_name text, p_phone text, p_rate_per_mile numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); target public.profiles; old_rate numeric;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;
  select * into target from public.profiles where id = p_driver_id for update;
  if target.id is null or target.role <> 'driver' or target.company_id <> actor.company_id then
    raise exception 'Driver not found';
  end if;
  if p_rate_per_mile is not null and (p_rate_per_mile <= 0 or p_rate_per_mile > 100
    or p_rate_per_mile <> round(p_rate_per_mile,4)) then
    raise exception 'Invalid USD per mile rate';
  end if;
  perform public.update_company_driver_contact(p_driver_id,p_full_name,p_phone);
  select rate_per_mile into old_rate from public.driver_pay_settings where driver_id=p_driver_id;
  insert into public.driver_pay_settings(driver_id,company_id,rate_per_mile,updated_by)
  values(target.id,actor.company_id,p_rate_per_mile,actor.id)
  on conflict(driver_id) do update set rate_per_mile=excluded.rate_per_mile,
    updated_by=excluded.updated_by,updated_at=now();
  if old_rate is distinct from p_rate_per_mile then
    insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
    values(actor.company_id,actor.id,'driver.pay_settings_updated','profile',p_driver_id,
      jsonb_build_object('rate_per_mile',old_rate),jsonb_build_object('rate_per_mile',p_rate_per_mile,
      'distance_basis','deadhead_and_loaded','applies_to','future_assignments'));
  end if;
end $$;
revoke all on function public.update_driver_contact_and_pay(uuid,text,text,numeric) from public, anon;
grant execute on function public.update_driver_contact_and_pay(uuid,text,text,numeric) to authenticated;

create function private.pay_route_fingerprint(p_load_id uuid) returns text
language sql volatile security definer set search_path = '' as $$
  select md5(coalesce(jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,
    postal_code,latitude,longitude) order by sequence,id)::text,'[]'))
  from public.load_stops where load_id=p_load_id;
$$;
revoke all on function private.pay_route_fingerprint(uuid) from public, anon, authenticated;

-- Service role only. Values come from the existing road-route provider, never the browser.
create function public.prepare_driver_pay_quote(p_load_id uuid,p_driver_id uuid,
 p_requested_by uuid,p_rate numeric,p_loaded_miles numeric,p_deadhead_miles numeric,
 p_stops jsonb,p_latitude double precision,p_longitude double precision,
 p_location_at timestamptz,p_provider text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; target public.profiles; expected_stops jsonb;
begin
 select * into actor from public.profiles where id=p_requested_by;
 select * into target from public.profiles where id=p_driver_id for update;
 if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher')
  or target.id is null or target.status <> 'active' or target.role <> 'driver'
  or target.company_id <> actor.company_id
  or not exists(select 1 from public.loads where id=p_load_id and company_id=actor.company_id)
 then raise exception 'Driver pay quote permission denied'; end if;
 if actor.role='dispatcher' and exists(select 1 from public.dispatcher_driver_access where dispatcher_id=actor.id)
  and not exists(select 1 from public.dispatcher_driver_access where dispatcher_id=actor.id and driver_id=target.id) then
   raise exception 'Driver pay quote permission denied';
 end if;
 if not exists(select 1 from public.driver_pay_settings where driver_id=p_driver_id and rate_per_mile=p_rate)
  then raise exception 'Driver pay settings changed; retry assignment'; end if;
 select jsonb_agg(jsonb_build_array(id,type,sequence,address_line,city,region,postal_code,
   latitude,longitude) order by sequence,id) into expected_stops from public.load_stops where load_id=p_load_id;
 if p_stops is distinct from expected_stops then raise exception 'Route changed; recalculate'; end if;
 if p_location_at < now()-interval '5 minutes' or p_location_at > now()+interval '1 minute'
   or p_provider not in ('mapbox','google_routes') then raise exception 'Fresh road route required'; end if;
 insert into private.driver_pay_quotes(load_id,driver_id,requested_by,rate_per_mile,loaded_miles,
  deadhead_miles,route_fingerprint,origin_latitude,origin_longitude,location_at,provider)
 values(p_load_id,p_driver_id,p_requested_by,p_rate,p_loaded_miles,p_deadhead_miles,
  private.pay_route_fingerprint(p_load_id),p_latitude,p_longitude,p_location_at,p_provider)
 on conflict(load_id,driver_id) do update set requested_by=excluded.requested_by,
 rate_per_mile=excluded.rate_per_mile,loaded_miles=excluded.loaded_miles,deadhead_miles=excluded.deadhead_miles,
 route_fingerprint=excluded.route_fingerprint,origin_latitude=excluded.origin_latitude,
 origin_longitude=excluded.origin_longitude,location_at=excluded.location_at,provider=excluded.provider,created_at=now();
end $$;
revoke all on function public.prepare_driver_pay_quote(uuid,uuid,uuid,numeric,numeric,numeric,jsonb,double precision,double precision,timestamptz,text) from public, anon, authenticated;
grant execute on function public.prepare_driver_pay_quote(uuid,uuid,uuid,numeric,numeric,numeric,jsonb,double precision,double precision,timestamptz,text) to service_role;

create function private.freeze_driver_pay() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rate numeric; quote private.driver_pay_quotes;
begin
 perform 1 from public.profiles where id=new.driver_id for update;
 select rate_per_mile into rate from public.driver_pay_settings where driver_id=new.driver_id;
 if rate is null then return new; end if;
 select * into quote from private.driver_pay_quotes where load_id=new.load_id and driver_id=new.driver_id for update;
 if quote.load_id is null or quote.requested_by <> new.assigned_by
   or quote.rate_per_mile <> rate or quote.created_at < now()-interval '5 minutes'
   or quote.location_at < now()-interval '10 minutes'
   or quote.route_fingerprint <> private.pay_route_fingerprint(new.load_id)
 then raise exception 'DRIVER_PAY_ROUTE_REQUIRED'; end if;
 insert into public.assignment_driver_pay(assignment_id,load_id,driver_id,company_id,rate_per_mile,
   loaded_miles,deadhead_miles,route_fingerprint,origin_latitude,origin_longitude,location_at,provider)
 values(new.id,new.load_id,new.driver_id,new.company_id,rate,quote.loaded_miles,quote.deadhead_miles,
   quote.route_fingerprint,quote.origin_latitude,quote.origin_longitude,quote.location_at,quote.provider);
 delete from private.driver_pay_quotes where load_id=new.load_id and driver_id=new.driver_id;
 return new;
end $$;
revoke all on function private.freeze_driver_pay() from public, anon, authenticated;
create trigger assignments_freeze_driver_pay after insert on public.assignments
 for each row execute function private.freeze_driver_pay();

create function private.immutable_driver_pay() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Driver pay snapshot is immutable'; end $$;
revoke all on function private.immutable_driver_pay() from public, anon, authenticated;
create trigger assignment_driver_pay_immutable before update on public.assignment_driver_pay
 for each row execute function private.immutable_driver_pay();

-- Offers contain broker RPM; fixed-pay drivers use the guarded direct path.
create function private.guard_fixed_pay_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.driver_pay_settings where driver_id=new.driver_id and rate_per_mile is not null) then
  raise exception 'Use direct assignment for fixed-mileage drivers';
 end if;
 return new;
end $$;
revoke all on function private.guard_fixed_pay_offer() from public, anon, authenticated;
create trigger offers_fixed_pay_guard before insert on public.offers
 for each row execute function private.guard_fixed_pay_offer();

-- Restrictive policies compose with existing tenant/assignment checks, never replace them.
create function private.hide_broker_terms(p_load_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(public.current_app_role()='driver' and exists(
   select 1 from public.assignment_driver_pay p where p.assignment_id=(
     select a.id from public.assignments a where a.driver_id=(select auth.uid()) and a.load_id=p_load_id
     order by a.assigned_at desc, a.id desc limit 1)
 ),false);
$$;
revoke all on function private.hide_broker_terms(uuid) from public, anon;
grant execute on function private.hide_broker_terms(uuid) to authenticated;
create policy loads_driver_pay_privacy on public.loads as restrictive for select to authenticated
 using (not private.hide_broker_terms(id));
create policy prices_driver_pay_privacy on public.load_price_snapshots as restrictive for select to authenticated
 using (not private.hide_broker_terms(load_id));
create policy offers_driver_pay_privacy on public.offers as restrictive for select to authenticated
 using (not private.hide_broker_terms(load_id));
create policy warnings_driver_pay_privacy on public.warnings as restrictive for select to authenticated
 using (not private.hide_broker_terms(load_id));
create policy documents_driver_pay_privacy on public.documents as restrictive for select to authenticated
 using (document_type not in ('rate_confirmation','receipt') or not private.hide_broker_terms(load_id));

create function private.hidden_driver_pay_file(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id
   where v.storage_path=p_path and d.document_type in ('rate_confirmation','receipt')
    and private.hide_broker_terms(d.load_id));
$$;
revoke all on function private.hidden_driver_pay_file(text) from public, anon;
grant execute on function private.hidden_driver_pay_file(text) to authenticated;
create policy versions_driver_pay_privacy on public.document_versions as restrictive for select to authenticated
 using (not private.hidden_driver_pay_file(storage_path));
create policy assets_driver_pay_privacy on public.media_assets as restrictive for select to authenticated
 using (not private.hidden_driver_pay_file('cloudinary:' || id::text));
create policy storage_driver_pay_privacy on storage.objects as restrictive for select to authenticated
 using (not private.hidden_driver_pay_file(name));
create policy chat_driver_pay_privacy on public.chat_messages as restrictive for select to authenticated
 using (not private.hidden_driver_pay_file(storage_path));

-- Driver-specific projection. Never fallback to raw loads if this RPC is unavailable.
create function public.get_driver_load_rows(p_load_ids uuid[]) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); l public.loads; pay public.assignment_driver_pay; result jsonb;
begin
 if actor.id is null or actor.status <> 'active' or actor.role <> 'driver' then
   raise exception 'Active driver required'; end if;
 if cardinality(p_load_ids)>200 then raise exception 'At most 200 loads per request'; end if;
 for l in select * from public.loads where id=any(p_load_ids) and company_id=actor.company_id
   and public.can_access_load(id) loop
   select p.* into pay from public.assignment_driver_pay p
    join public.assignments a on a.id=p.assignment_id
    where p.assignment_id=(select a2.id from public.assignments a2 where a2.load_id=l.id and a2.driver_id=actor.id
      order by a2.assigned_at desc,a2.id desc limit 1);
   if pay.assignment_id is null then result:=to_jsonb(l);
   else
    select jsonb_object_agg(key,value) into result from jsonb_each(to_jsonb(l))
      where key=any(array['id','company_id','load_number','status','current_assignment_id','version',
       'created_at','updated_at','execution_reset_at','broker_name','broker_contact_name','broker_phone','broker_email',
       'owner_dispatcher_id','cargo_description','equipment_type','freight_mode','weight_lbs',
       'temperature_fahrenheit','pallet_count','case_count','is_hazmat']);
    result:=result || jsonb_build_object('broker_rate',pay.amount,'loaded_miles',pay.loaded_miles,
     'loaded_rpm',pay.rate_per_mile,'driver_pay',to_jsonb(pay),'driver_brief',null,
     'special_instructions',null,'load_requirements','[]'::jsonb);
   end if;
   return next result;
 end loop;
end $$;
revoke all on function public.get_driver_load_rows(uuid[]) from public, anon;
grant execute on function public.get_driver_load_rows(uuid[]) to authenticated;

-- A safe invalidation signal for drivers whose raw load row is intentionally hidden.
alter table public.assignments add column load_revision bigint not null default 0;
create function private.notify_driver_load_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 update public.assignments set load_revision=load_revision+1
 where id=new.current_assignment_id and exists(select 1 from public.assignment_driver_pay where assignment_id=new.current_assignment_id);
 return new;
end $$;
revoke all on function private.notify_driver_load_revision() from public, anon, authenticated;
create trigger loads_driver_pay_revision after update on public.loads
 for each row when (new.trashed_at is null) execute function private.notify_driver_load_revision();

-- Driver analytics are calculated from accepted price snapshots and completed
-- assignments so mobile clients never have to reconstruct financial rules.

create or replace function public.get_driver_analytics(
  period_start timestamptz,
  period_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  range_end timestamptz := coalesce(period_end, now());
  previous_start timestamptz;
  previous_end timestamptz;
  result jsonb;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;
  if period_start is not null and range_end <= period_start then
    raise exception 'Analytics period is invalid';
  end if;

  if period_start is not null then
    previous_end := period_start;
    previous_start := period_start - (range_end - period_start);
  end if;

  with driver_rows as (
    select
      a.id as assignment_id,
      a.status,
      a.assigned_at,
      a.ended_at,
      l.id as load_id,
      l.load_number,
      coalesce(nullif(l.broker_name, ''), 'Broker') as broker_name,
      coalesce(pay.amount, s.broker_rate, l.broker_rate, 0)::numeric as gross_rate,
      coalesce(pay.loaded_miles, s.loaded_miles, l.loaded_miles, 0)::numeric as loaded_miles,
      coalesce(pay.deadhead_miles, o.estimated_deadhead_miles, 0)::numeric as deadhead_miles,
      delivery.appointment_from as delivery_from,
      delivery.appointment_to as delivery_to
    from public.assignments a
    join public.loads l on l.id = a.load_id and l.company_id = a.company_id
    left join public.assignment_driver_pay pay on pay.assignment_id = a.id
    left join public.load_price_snapshots s on s.id = a.accepted_price_snapshot_id
    left join public.offers o on o.id = a.offer_id
    left join lateral (
      select appointment_from, appointment_to from public.load_stops
      where load_id = l.id and type = 'delivery' order by sequence desc limit 1
    ) delivery on true
    where a.driver_id = actor.id and a.company_id = actor.company_id and l.trashed_at is null
  ),
  current_completed as (
    select *
    from driver_rows
    where status = 'completed'
      and ended_at is not null
      and (period_start is null or ended_at >= period_start)
      and ended_at < range_end
  ),
  previous_completed as (
    select *
    from driver_rows
    where status = 'completed'
      and ended_at is not null
      and previous_start is not null
      and ended_at >= previous_start
      and ended_at < previous_end
  ),
  totals as (
    select
      coalesce(sum(gross_rate), 0)::numeric as gross_revenue,
      coalesce(sum(loaded_miles), 0)::numeric as loaded_miles,
      coalesce(sum(deadhead_miles), 0)::numeric as deadhead_miles,
      count(*)::integer as completed_count,
      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
      )::integer as scheduled_count,
      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
          and ended_at <= coalesce(delivery_to, delivery_from)
      )::integer as on_time_count
    from current_completed
  ),
  previous_totals as (
    select coalesce(sum(gross_rate), 0)::numeric as gross_revenue
    from previous_completed
  ),
  daily_rows as (
    select
      date_trunc('day', ended_at) as day,
      sum(gross_rate)::numeric as gross_revenue,
      sum(loaded_miles + deadhead_miles)::numeric as total_miles,
      count(*)::integer as completed_count
    from current_completed
    group by date_trunc('day', ended_at)
    order by day
  ),
  recent_rows as (
    select *
    from current_completed
    order by ended_at desc
    limit 10
  )
  select jsonb_build_object(
    'grossRevenue', totals.gross_revenue,
    'loadedMiles', totals.loaded_miles,
    'deadheadMiles', totals.deadhead_miles,
    'effectiveRpm', case
      when totals.loaded_miles + totals.deadhead_miles > 0
        then totals.gross_revenue / (totals.loaded_miles + totals.deadhead_miles)
      else 0
    end,
    'completedCount', totals.completed_count,
    'activeCount', (
      select count(*)::integer from driver_rows where status = 'active'
    ),
    'scheduledCount', totals.scheduled_count,
    'onTimeCount', totals.on_time_count,
    'grossChangePercent', case
      when previous_totals.gross_revenue > 0
        then ((totals.gross_revenue - previous_totals.gross_revenue)
          / previous_totals.gross_revenue) * 100
      else null
    end,
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', day,
        'grossRevenue', gross_revenue,
        'totalMiles', total_miles,
        'completedCount', completed_count
      ) order by day)
      from daily_rows
    ), '[]'::jsonb),
    'recentLoads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'loadId', load_id,
        'loadNumber', load_number,
        'brokerName', broker_name,
        'grossRevenue', gross_rate,
        'loadedMiles', loaded_miles,
        'deadheadMiles', deadhead_miles,
        'completedAt', ended_at
      ) order by ended_at desc)
      from recent_rows
    ), '[]'::jsonb)
  )
  into result
  from totals cross join previous_totals;

  return result;
end;
$$;

revoke all on function public.get_driver_analytics(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_driver_analytics(timestamptz, timestamptz)
  to authenticated;
