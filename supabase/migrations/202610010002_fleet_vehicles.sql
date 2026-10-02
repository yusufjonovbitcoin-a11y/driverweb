create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_number text not null,
  vin text not null,
  make text not null,
  model text not null,
  model_year integer not null,
  fuel_type text not null,
  plate_issued_state text,
  plate_number text,
  sleeper_berth_enabled boolean not null default true,
  notes text,
  status text not null default 'active',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_number_length check (char_length(trim(vehicle_number)) between 1 and 30),
  constraint vehicles_vin_format check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  constraint vehicles_make_length check (char_length(trim(make)) between 1 and 80),
  constraint vehicles_model_length check (char_length(trim(model)) between 1 and 80),
  constraint vehicles_year_range check (model_year between 1980 and 2200),
  constraint vehicles_fuel_type check (fuel_type in ('diesel', 'gasoline', 'electric', 'hybrid', 'other')),
  constraint vehicles_plate_state_format check (plate_issued_state is null or plate_issued_state ~ '^[A-Z]{2}$'),
  constraint vehicles_plate_number_length check (plate_number is null or char_length(trim(plate_number)) between 1 and 20),
  constraint vehicles_plate_pair check ((plate_issued_state is null) = (plate_number is null)),
  constraint vehicles_notes_length check (notes is null or char_length(notes) <= 4000),
  constraint vehicles_status check (status in ('active', 'maintenance', 'inactive'))
);

create unique index vehicles_company_number_unique
  on public.vehicles(company_id, lower(vehicle_number));
create unique index vehicles_vin_unique
  on public.vehicles(upper(vin));
create unique index vehicles_company_plate_unique
  on public.vehicles(company_id, plate_issued_state, upper(plate_number))
  where plate_issued_state is not null and plate_number is not null;
create index vehicles_company_status_idx
  on public.vehicles(company_id, status, vehicle_number);

create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

create function public.prevent_vehicle_vin_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.vin is distinct from old.vin then
    raise exception 'VIN cannot be changed after vehicle creation';
  end if;
  return new;
end;
$$;

create trigger vehicles_vin_immutable
before update of vin on public.vehicles
for each row execute function public.prevent_vehicle_vin_change();

create table public.vehicle_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  constraint vehicle_assignment_time_order check (unassigned_at is null or unassigned_at >= assigned_at)
);

create unique index vehicle_driver_assignments_active_vehicle_unique
  on public.vehicle_driver_assignments(vehicle_id)
  where unassigned_at is null;
create unique index vehicle_driver_assignments_active_driver_unique
  on public.vehicle_driver_assignments(driver_id)
  where unassigned_at is null;
create index vehicle_driver_assignments_history_idx
  on public.vehicle_driver_assignments(company_id, driver_id, assigned_at desc);

create function public.ensure_vehicle_assignment_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_company uuid;
  driver_company uuid;
  driver_role public.app_role;
  driver_status public.account_status;
begin
  select company_id into vehicle_company from public.vehicles where id = new.vehicle_id;
  select company_id, role, status into driver_company, driver_role, driver_status
  from public.profiles where id = new.driver_id;

  if vehicle_company is null or driver_company is null
    or new.company_id <> vehicle_company or new.company_id <> driver_company then
    raise exception 'Vehicle and driver must belong to the same company';
  end if;
  if driver_role <> 'driver' or driver_status <> 'active' then
    raise exception 'Only an active driver may be assigned';
  end if;
  return new;
end;
$$;

create trigger vehicle_assignments_validate_tenant
before insert or update of company_id, vehicle_id, driver_id
on public.vehicle_driver_assignments
for each row execute function public.ensure_vehicle_assignment_tenant();

alter table public.vehicles enable row level security;
alter table public.vehicle_driver_assignments enable row level security;

create policy vehicles_read on public.vehicles
for select to authenticated
using (
  company_id = public.current_company_id()
  and (
    public.is_privileged_member()
    or exists (
      select 1 from public.vehicle_driver_assignments a
      where a.vehicle_id = vehicles.id
        and a.driver_id = (select auth.uid())
        and a.unassigned_at is null
    )
  )
);

create policy vehicle_assignments_read on public.vehicle_driver_assignments
for select to authenticated
using (
  company_id = public.current_company_id()
  and (public.is_privileged_member() or driver_id = (select auth.uid()))
);

revoke all on public.vehicles, public.vehicle_driver_assignments from anon, authenticated;
grant select on public.vehicles, public.vehicle_driver_assignments to authenticated;

create view public.fleet_vehicle_overview
with (security_invoker = true)
as
select
  v.id,
  v.company_id,
  v.vehicle_number,
  v.vin,
  v.make,
  v.model,
  v.model_year,
  v.fuel_type,
  v.plate_issued_state,
  v.plate_number,
  v.sleeper_berth_enabled,
  v.notes,
  v.status,
  v.created_at,
  v.updated_at,
  a.id as assignment_id,
  a.driver_id,
  p.full_name as driver_name,
  a.assigned_at
from public.vehicles v
left join public.vehicle_driver_assignments a
  on a.vehicle_id = v.id and a.unassigned_at is null
left join public.profiles p on p.id = a.driver_id;

grant select on public.fleet_vehicle_overview to authenticated;

create function public.create_fleet_vehicle(
  p_vehicle_number text,
  p_vin text,
  p_make text,
  p_model text,
  p_model_year integer,
  p_fuel_type text,
  p_plate_issued_state text default null,
  p_plate_number text default null,
  p_sleeper_berth_enabled boolean default true,
  p_notes text default null,
  p_driver_id uuid default null
)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.vehicles;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;
  if p_model_year < 1980 or p_model_year > extract(year from current_date)::integer + 2 then
    raise exception 'Vehicle model year is outside the supported range';
  end if;

  insert into public.vehicles(
    company_id, vehicle_number, vin, make, model, model_year, fuel_type,
    plate_issued_state, plate_number, sleeper_berth_enabled, notes, created_by
  ) values (
    actor.company_id,
    trim(p_vehicle_number),
    upper(trim(p_vin)),
    trim(p_make),
    trim(p_model),
    p_model_year,
    lower(trim(p_fuel_type)),
    nullif(upper(trim(p_plate_issued_state)), ''),
    nullif(upper(trim(p_plate_number)), ''),
    coalesce(p_sleeper_berth_enabled, true),
    nullif(trim(p_notes), ''),
    actor.id
  ) returning * into result;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'vehicle.created', 'vehicle', result.id,
    jsonb_build_object('vehicleNumber', result.vehicle_number, 'vin', result.vin)
  );
  if p_driver_id is not null then
    perform public.assign_vehicle_driver(result.id, p_driver_id);
  end if;
  return result;
end;
$$;

create function public.update_fleet_vehicle(
  p_vehicle_id uuid,
  p_vehicle_number text,
  p_make text,
  p_model text,
  p_model_year integer,
  p_fuel_type text,
  p_plate_issued_state text default null,
  p_plate_number text default null,
  p_sleeper_berth_enabled boolean default true,
  p_notes text default null,
  p_status text default 'active'
)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.vehicles;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;
  if p_model_year < 1980 or p_model_year > extract(year from current_date)::integer + 2 then
    raise exception 'Vehicle model year is outside the supported range';
  end if;

  update public.vehicles
  set vehicle_number = trim(p_vehicle_number),
      make = trim(p_make),
      model = trim(p_model),
      model_year = p_model_year,
      fuel_type = lower(trim(p_fuel_type)),
      plate_issued_state = nullif(upper(trim(p_plate_issued_state)), ''),
      plate_number = nullif(upper(trim(p_plate_number)), ''),
      sleeper_berth_enabled = coalesce(p_sleeper_berth_enabled, true),
      notes = nullif(trim(p_notes), ''),
      status = lower(trim(p_status))
  where id = p_vehicle_id and company_id = actor.company_id
  returning * into result;

  if result.id is null then raise exception 'Vehicle not found'; end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'vehicle.updated', 'vehicle', result.id,
    jsonb_build_object('vehicleNumber', result.vehicle_number, 'status', result.status)
  );
  return result;
end;
$$;

create function public.assign_vehicle_driver(p_vehicle_id uuid, p_driver_id uuid)
returns public.vehicle_driver_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_vehicle public.vehicles;
  target_driver public.profiles;
  result public.vehicle_driver_assignments;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;

  select * into target_vehicle from public.vehicles
  where id = p_vehicle_id and company_id = actor.company_id and status = 'active'
  for update;
  select * into target_driver from public.profiles
  where id = p_driver_id and company_id = actor.company_id and role = 'driver' and status = 'active'
  for update;
  if target_vehicle.id is null then raise exception 'Active vehicle not found'; end if;
  if target_driver.id is null then raise exception 'Active driver not found'; end if;

  update public.driver_profiles d
  set vehicle_type = null, updated_at = now()
  where d.company_id = actor.company_id
    and exists (
      select 1 from public.vehicle_driver_assignments current_assignment
      where current_assignment.driver_id = d.user_id
        and current_assignment.unassigned_at is null
        and (current_assignment.vehicle_id = p_vehicle_id or current_assignment.driver_id = p_driver_id)
    );

  update public.vehicle_driver_assignments
  set unassigned_at = now()
  where company_id = actor.company_id
    and unassigned_at is null
    and (vehicle_id = p_vehicle_id or driver_id = p_driver_id);

  insert into public.vehicle_driver_assignments(company_id, vehicle_id, driver_id, assigned_by)
  values (actor.company_id, p_vehicle_id, p_driver_id, actor.id)
  returning * into result;

  update public.driver_profiles
  set vehicle_type = concat_ws(' · ', target_vehicle.vehicle_number, target_vehicle.make, target_vehicle.model),
      updated_at = now()
  where user_id = p_driver_id and company_id = actor.company_id;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'vehicle.driver_assigned', 'vehicle', p_vehicle_id,
    jsonb_build_object('driverId', p_driver_id, 'assignmentId', result.id)
  );
  return result;
end;
$$;

create function public.unassign_vehicle_driver(p_vehicle_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  previous_driver_id uuid;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;

  update public.vehicle_driver_assignments
  set unassigned_at = now()
  where vehicle_id = p_vehicle_id
    and company_id = actor.company_id
    and unassigned_at is null
  returning driver_id into previous_driver_id;

  if previous_driver_id is null then return false; end if;
  update public.driver_profiles
  set vehicle_type = null, updated_at = now()
  where user_id = previous_driver_id and company_id = actor.company_id;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, old_value)
  values (
    actor.company_id, actor.id, 'vehicle.driver_unassigned', 'vehicle', p_vehicle_id,
    jsonb_build_object('driverId', previous_driver_id)
  );
  return true;
end;
$$;

revoke all on function public.create_fleet_vehicle(text, text, text, text, integer, text, text, text, boolean, text, uuid) from public, anon;
revoke all on function public.update_fleet_vehicle(uuid, text, text, text, integer, text, text, text, boolean, text, text) from public, anon;
revoke all on function public.assign_vehicle_driver(uuid, uuid) from public, anon;
revoke all on function public.unassign_vehicle_driver(uuid) from public, anon;
grant execute on function public.create_fleet_vehicle(text, text, text, text, integer, text, text, text, boolean, text, uuid) to authenticated;
grant execute on function public.update_fleet_vehicle(uuid, text, text, text, integer, text, text, text, boolean, text, text) to authenticated;
grant execute on function public.assign_vehicle_driver(uuid, uuid) to authenticated;
grant execute on function public.unassign_vehicle_driver(uuid) to authenticated;

-- Truck master data is now managed centrally. Drivers retain read access to
-- their active assignment but can no longer mutate the legacy truck fields.
revoke execute on function public.update_my_truck_profile(
  text, text, text, integer, text, text, integer, text, text
) from authenticated;

create or replace view public.member_directory
with (security_invoker = true)
as
select
  p.id,
  p.company_id,
  p.role,
  p.status,
  p.full_name,
  case when public.is_privileged_member() then p.email else null end as email,
  case when public.is_privileged_member() then p.phone else null end as phone,
  coalesce(v.vehicle_number, d.vehicle_type) as vehicle_type,
  d.trailer_type,
  d.capacity_lbs,
  d.equipment,
  d.hos_available_minutes,
  p.avatar_path,
  v.id as assigned_vehicle_id,
  v.vehicle_number,
  v.make as vehicle_make,
  v.model as vehicle_model,
  v.model_year as vehicle_year,
  v.vin as vehicle_vin,
  v.fuel_type as vehicle_fuel_type,
  v.plate_issued_state as vehicle_plate_state,
  v.plate_number as vehicle_plate_number,
  v.sleeper_berth_enabled,
  v.notes as vehicle_notes
from public.profiles p
left join public.driver_profiles d on d.user_id = p.id
left join public.vehicle_driver_assignments a
  on a.driver_id = p.id and a.unassigned_at is null
left join public.vehicles v on v.id = a.vehicle_id
where p.company_id = public.current_company_id()
  and (public.is_privileged_member() or p.id = (select auth.uid()));

grant select on public.member_directory to authenticated;
