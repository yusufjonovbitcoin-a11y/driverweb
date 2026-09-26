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
  d.hos_available_minutes,
  p.avatar_path
from public.profiles p
left join public.driver_profiles d on d.user_id = p.id
where p.company_id = public.current_company_id()
  and (
    public.is_privileged_member()
    or p.id = (select auth.uid())
  );

grant select on public.member_directory to authenticated;
