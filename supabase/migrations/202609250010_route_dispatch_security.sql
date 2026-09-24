-- Require a recent server-calculated route before offers can be dispatched.
-- This closes the gap for environments where migration 009 was applied before
-- the freshness guard was added to the canonical migration.

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

revoke all on function public.send_routed_offers(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.send_routed_offers(uuid, jsonb, jsonb)
  to authenticated;
