alter table public.driver_profiles
  add column cdl_number text,
  add column cdl_state text,
  add column cdl_expires_on date,
  add column duty_status text not null default 'off_duty'
    check (duty_status in ('on_duty', 'driving', 'sleeper_berth', 'off_duty')),
  add column unit_number text,
  add column vehicle_make text,
  add column vehicle_model text,
  add column vehicle_year integer check (vehicle_year is null or vehicle_year between 1900 and 2200),
  add column vin text,
  add column license_plate text,
  add column current_mileage integer check (current_mileage is null or current_mileage >= 0),
  add column dot_number text,
  add column mc_number text;

create or replace function public.set_driver_duty_status(next_status text)
returns public.driver_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.driver_profiles;
begin
  if actor.id is null or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;
  if next_status not in ('on_duty', 'driving', 'sleeper_berth', 'off_duty') then
    raise exception 'Invalid duty status';
  end if;

  update public.driver_profiles
  set duty_status = next_status, updated_at = now()
  where user_id = actor.id and company_id = actor.company_id
  returning * into result;
  if result.user_id is null then raise exception 'Driver profile not found'; end if;

  if next_status = 'off_duty' then
    update public.driver_presence
    set is_online = false, updated_at = now()
    where driver_id = actor.id;
  end if;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'driver.duty_status_changed',
    'driver_profile', actor.id, jsonb_build_object('dutyStatus', next_status)
  );
  return result;
end;
$$;

revoke all on function public.set_driver_duty_status(text) from public, anon;
grant execute on function public.set_driver_duty_status(text) to authenticated;
