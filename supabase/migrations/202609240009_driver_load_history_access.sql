-- A driver may read an active or historical load assigned to them. An offer
-- alone grants access only while it is pending; declined, withdrawn, and
-- superseded offers must not keep load details visible forever.

create or replace function public.can_access_load(target_load_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_role() = 'super_admin' then true
    when public.current_app_role() in ('company_admin', 'dispatcher') then
      exists (
        select 1 from public.loads l
        where l.id = target_load_id and l.company_id = public.current_company_id()
      )
    when public.current_app_role() = 'driver' then
      exists (
        select 1
        from public.loads l
        left join public.assignments a on a.id = l.current_assignment_id
        where l.id = target_load_id
          and l.company_id = public.current_company_id()
          and (
            a.driver_id = (select auth.uid())
            or exists (
              select 1 from public.offers o
              where o.load_id = l.id
                and o.driver_id = (select auth.uid())
                and o.status = 'pending'
            )
          )
      )
    else false
  end;
$$;

revoke all on function public.can_access_load(uuid) from public, anon;
grant execute on function public.can_access_load(uuid) to authenticated;
