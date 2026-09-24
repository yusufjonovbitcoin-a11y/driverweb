-- Persist Google road-distance estimates before offers are delivered. Broker
-- reported mileage is retained separately for audit and comparison.

alter table public.loads
  add column if not exists broker_reported_miles numeric(10,2)
    check (broker_reported_miles is null or broker_reported_miles >= 0),
  add column if not exists route_distance_miles numeric(10,2)
    check (route_distance_miles is null or route_distance_miles >= 0),
  add column if not exists route_duration_seconds integer
    check (route_duration_seconds is null or route_duration_seconds >= 0),
  add column if not exists route_provider text,
  add column if not exists route_calculated_at timestamptz;

update public.loads
set broker_reported_miles = loaded_miles
where broker_reported_miles is null and loaded_miles > 0;

create or replace function public.apply_route_estimate(
  load_id uuid,
  calculated_distance_miles numeric,
  calculated_duration_seconds integer,
  calculated_provider text default 'google_routes'
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  saved public.loads;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  if calculated_distance_miles is null or calculated_distance_miles <= 0 then
    raise exception 'Route distance must be positive';
  end if;
  if calculated_duration_seconds is null or calculated_duration_seconds < 0 then
    raise exception 'Route duration is invalid';
  end if;

  update public.loads l set
    broker_reported_miles = case
      when l.broker_reported_miles is null and l.loaded_miles > 0 then l.loaded_miles
      else l.broker_reported_miles
    end,
    loaded_miles = round(calculated_distance_miles, 2),
    route_distance_miles = round(calculated_distance_miles, 2),
    route_duration_seconds = calculated_duration_seconds,
    route_provider = left(coalesce(nullif(trim(calculated_provider), ''), 'google_routes'), 80),
    route_calculated_at = now(),
    version = l.version + 1
  where l.id = load_id
    and l.company_id = actor.company_id
    and l.status in ('ready_for_offer', 'offered')
  returning l.* into saved;

  if saved.id is null then
    raise exception 'Load is not available for route calculation';
  end if;

  insert into public.load_price_snapshots(
    company_id, load_id, broker_rate, loaded_miles, loaded_rpm,
    requires_driver_reconfirmation, created_by
  ) values (
    actor.company_id,
    saved.id,
    saved.broker_rate,
    saved.loaded_miles,
    case when saved.loaded_miles > 0 then saved.broker_rate / saved.loaded_miles else 0 end,
    false,
    actor.id
  );

  update public.offers o set
    loaded_miles = saved.loaded_miles,
    effective_rpm = case
      when saved.loaded_miles + o.estimated_deadhead_miles > 0
        then saved.broker_rate / (saved.loaded_miles + o.estimated_deadhead_miles)
      else 0
    end
  where o.load_id = saved.id and o.status = 'pending';

  insert into public.audit_events(
    company_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    actor.company_id,
    actor.id,
    'load.route_calculated',
    'load',
    saved.id,
    jsonb_build_object(
      'provider', saved.route_provider,
      'distanceMiles', saved.route_distance_miles,
      'durationSeconds', saved.route_duration_seconds,
      'brokerReportedMiles', saved.broker_reported_miles
    )
  );
  return saved;
end;
$$;

create or replace function public.send_routed_offers(
  load_id uuid,
  offer_targets jsonb,
  compatibility_warnings jsonb default '[]'::jsonb
)
returns setof public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target jsonb;
  target_driver_id uuid;
  target_warnings jsonb;
  processed_driver_ids uuid[] := '{}'::uuid[];
  sent_offer public.offers;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  if jsonb_typeof(offer_targets) <> 'array' or jsonb_array_length(offer_targets) = 0 then
    raise exception 'At least one route target is required';
  end if;
  if not exists (
    select 1 from public.loads l
    where l.id = load_id
      and l.company_id = actor.company_id
      and l.status in ('ready_for_offer', 'offered')
      and l.route_distance_miles > 0
      and l.route_calculated_at >= now() - interval '15 minutes'
  ) then
    raise exception 'Fresh route calculation required';
  end if;

  for target in select value from jsonb_array_elements(offer_targets) loop
    target_driver_id := nullif(target->>'driverId', '')::uuid;
    if target_driver_id is null or target_driver_id = any(processed_driver_ids) then
      continue;
    end if;
    processed_driver_ids := array_append(processed_driver_ids, target_driver_id);
    target_warnings := coalesce(compatibility_warnings, '[]'::jsonb);
    if not coalesce((target->>'hasCurrentLocation')::boolean, false) then
      target_warnings := target_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'driver_location_unavailable',
        'field', 'driverLocation',
        'message', 'Driver lokatsiyasi mavjud emas. Pickupgacha masofa hisoblanmadi.'
      ));
    end if;

    select * into sent_offer from public.send_offer(
      load_id,
      target_driver_id,
      nullif(target->>'originLatitude', '')::numeric,
      nullif(target->>'originLongitude', '')::numeric,
      greatest(coalesce(nullif(target->>'deadheadMiles', '')::numeric, 0), 0),
      target_warnings
    );
    return next sent_offer;
  end loop;
  return;
end;
$$;

revoke all on function public.apply_route_estimate(uuid, numeric, integer, text)
  from public, anon;
revoke all on function public.send_routed_offers(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.apply_route_estimate(uuid, numeric, integer, text)
  to authenticated;
grant execute on function public.send_routed_offers(uuid, jsonb, jsonb)
  to authenticated;
