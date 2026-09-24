-- Make dispatcher offer delivery atomic and safe to retry. A network retry or
-- a partially completed client loop must never create duplicate pending offers.

create or replace function public.send_offer(
  load_id uuid,
  driver_id uuid,
  origin_latitude numeric default null,
  origin_longitude numeric default null,
  estimated_deadhead_miles numeric default 0,
  compatibility_warnings jsonb default '[]'::jsonb
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  result public.offers;
  driver_is_online boolean;
  next_offer_status public.offer_status;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;

  select * into target_load from public.loads
  where id = load_id and company_id = actor.company_id for update;

  if target_load.id is null or target_load.status not in ('ready_for_offer', 'offered') then
    raise exception 'Load is not available for offers';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = driver_id and company_id = actor.company_id and role = 'driver' and status = 'active'
  ) or not public.can_access_driver(driver_id) then
    raise exception 'Driver is not eligible';
  end if;

  -- Idempotent retry: return the still-active offer instead of violating the
  -- partial unique index on (load_id, driver_id).
  select * into result
  from public.offers o
  where o.load_id = target_load.id
    and o.driver_id = send_offer.driver_id
    and o.status = 'pending'
  order by o.created_at desc
  limit 1
  for update;
  if result.id is not null then return result; end if;

  select coalesce(p.is_online and p.last_seen_at >= now() - interval '2 minutes', false)
  into driver_is_online
  from public.driver_presence p
  where p.driver_id = send_offer.driver_id and p.company_id = actor.company_id;
  driver_is_online := coalesce(driver_is_online, false);

  -- Repeated clicks while the driver is offline should not grow the audit
  -- table with identical missed offers.
  if not driver_is_online then
    select * into result
    from public.offers o
    where o.load_id = target_load.id
      and o.driver_id = send_offer.driver_id
      and o.status = 'missed_offline'
    order by o.created_at desc
    limit 1
    for update;
    if result.id is not null then return result; end if;
  end if;

  next_offer_status := case
    when driver_is_online then 'pending'::public.offer_status
    else 'missed_offline'::public.offer_status
  end;

  insert into public.offers(
    company_id, load_id, driver_id, status, origin_latitude, origin_longitude,
    estimated_deadhead_miles, loaded_miles, effective_rpm,
    compatibility_warnings, delivered_at, created_by
  ) values (
    actor.company_id, target_load.id, driver_id, next_offer_status,
    origin_latitude, origin_longitude, greatest(estimated_deadhead_miles, 0),
    target_load.loaded_miles,
    case when target_load.loaded_miles + greatest(estimated_deadhead_miles, 0) > 0
      then target_load.broker_rate / (target_load.loaded_miles + greatest(estimated_deadhead_miles, 0)) else 0 end,
    coalesce(compatibility_warnings, '[]'::jsonb),
    case when driver_is_online then now() else null end,
    actor.id
  ) returning * into result;

  if driver_is_online then
    update public.loads set status = 'offered', version = version + 1 where id = target_load.id;
    insert into public.notifications(company_id, recipient_id, type, title, body, entity_type, entity_id)
    values (actor.company_id, driver_id, 'load_offer', 'New load offer', 'A dispatcher sent you a load offer.', 'offer', result.id);
  end if;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id,
    actor.id,
    case when driver_is_online then 'offer.sent' else 'offer.missed_offline' end,
    'offer',
    result.id,
    to_jsonb(result)
  );
  return result;
end;
$$;

create or replace function public.send_offers(
  load_id uuid,
  driver_ids uuid[],
  compatibility_warnings jsonb default '[]'::jsonb
)
returns setof public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_driver_id uuid;
  processed_driver_ids uuid[] := '{}'::uuid[];
  sent_offer public.offers;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  if coalesce(array_length(driver_ids, 1), 0) = 0 then
    raise exception 'At least one driver is required';
  end if;

  foreach target_driver_id in array driver_ids loop
    if target_driver_id is null or target_driver_id = any(processed_driver_ids) then
      continue;
    end if;
    processed_driver_ids := array_append(processed_driver_ids, target_driver_id);
    select * into sent_offer from public.send_offer(
      load_id,
      target_driver_id,
      null,
      null,
      0,
      coalesce(compatibility_warnings, '[]'::jsonb)
    );
    return next sent_offer;
  end loop;
  return;
end;
$$;

revoke all on function public.send_offers(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.send_offers(uuid, uuid[], jsonb) to authenticated;
