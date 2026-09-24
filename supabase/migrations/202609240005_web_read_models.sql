-- Read models consumed by the dispatcher web. These views stay read-only and
-- inherit the underlying table RLS through security_invoker.

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
  d.vehicle_type,
  d.trailer_type,
  d.capacity_lbs,
  d.equipment,
  d.hos_available_minutes
from public.profiles p
left join public.driver_profiles d on d.user_id = p.id
where p.company_id = public.current_company_id()
  and (
    public.is_privileged_member()
    or p.id = (select auth.uid())
  );

create or replace view public.load_overview
with (security_invoker = true)
as
select
  l.id,
  l.company_id,
  l.load_number,
  l.status,
  l.broker_name,
  l.cargo_description,
  l.equipment_type,
  l.weight_lbs,
  l.broker_rate,
  l.loaded_miles,
  l.loaded_rpm,
  l.owner_dispatcher_id,
  l.current_assignment_id,
  l.version,
  l.updated_at,
  pickup.facility_name as pickup_facility,
  pickup.city as pickup_city,
  pickup.region as pickup_region,
  pickup.appointment_from as pickup_from,
  pickup.appointment_to as pickup_to,
  pickup.status as pickup_status,
  delivery.facility_name as delivery_facility,
  delivery.city as delivery_city,
  delivery.region as delivery_region,
  delivery.appointment_from as delivery_from,
  delivery.appointment_to as delivery_to,
  delivery.status as delivery_status,
  a.driver_id,
  pickup.address_line as pickup_address,
  pickup.latitude as pickup_latitude,
  pickup.longitude as pickup_longitude,
  delivery.address_line as delivery_address,
  delivery.latitude as delivery_latitude,
  delivery.longitude as delivery_longitude,
  a.requires_reconfirmation
from public.loads l
left join public.load_stops pickup on pickup.load_id = l.id and pickup.type = 'pickup'
left join public.load_stops delivery on delivery.load_id = l.id and delivery.type = 'delivery'
left join public.assignments a on a.id = l.current_assignment_id;

grant select on public.member_directory, public.load_overview to authenticated;
