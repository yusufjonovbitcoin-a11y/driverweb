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
  if actor.id is null or actor.role <> 'driver' then
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
      coalesce(s.broker_rate, l.broker_rate, 0)::numeric as gross_rate,
      coalesce(s.loaded_miles, l.loaded_miles, 0)::numeric as loaded_miles,
      coalesce(o.estimated_deadhead_miles, 0)::numeric as deadhead_miles,
      delivery.appointment_from as delivery_from,
      delivery.appointment_to as delivery_to
    from public.assignments a
    join public.loads l on l.id = a.load_id and l.company_id = a.company_id
    left join public.load_price_snapshots s on s.id = a.accepted_price_snapshot_id
    left join public.offers o on o.id = a.offer_id
    left join public.load_stops delivery
      on delivery.load_id = l.id and delivery.type = 'delivery'
    where a.driver_id = actor.id and a.company_id = actor.company_id
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
