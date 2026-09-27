-- A driver's default chat follows the staff member responsible for the
-- current load. Historical conversations remain stored, but an inactive
-- dispatcher must never stay selected just because that chat was most recent.

create or replace function public.open_default_driver_chat()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_id uuid;
begin
  if actor.id is null or actor.role <> 'driver' or actor.status <> 'active' then
    raise exception 'Driver permission required';
  end if;

  -- The owner of the driver's current operational load is the authoritative
  -- chat counterpart. The offboarding flow transfers open loads before a
  -- dispatcher is suspended, so this always resolves to active staff.
  select l.owner_dispatcher_id into target_id
  from public.assignments a
  join public.loads l
    on l.id = a.load_id
   and l.current_assignment_id = a.id
   and l.company_id = actor.company_id
  join public.profiles p
    on p.id = l.owner_dispatcher_id
   and p.company_id = actor.company_id
   and p.status = 'active'
   and p.role in ('dispatcher', 'company_admin')
  where a.driver_id = actor.id
    and a.company_id = actor.company_id
    and a.status = 'active'
    and l.status not in ('completed', 'cancelled')
  order by a.assigned_at desc, l.updated_at desc, l.id
  limit 1;

  -- Without a current load, prefer an explicit dispatcher-to-driver scope.
  if target_id is null then
    select p.id into target_id
    from public.dispatcher_driver_access access
    join public.profiles p
      on p.id = access.dispatcher_id
     and p.company_id = actor.company_id
     and p.role = 'dispatcher'
     and p.status = 'active'
    where access.driver_id = actor.id
      and access.company_id = actor.company_id
    order by p.created_at, p.id
    limit 1;
  end if;

  -- Keep an existing conversation only when its staff participant is active.
  if target_id is null then
    select c.dispatcher_id into target_id
    from public.chat_conversations c
    join public.profiles p
      on p.id = c.dispatcher_id
     and p.company_id = actor.company_id
     and p.status = 'active'
     and p.role in ('dispatcher', 'company_admin')
    where c.driver_id = actor.id
      and c.company_id = actor.company_id
    order by c.last_message_at desc, c.id
    limit 1;
  end if;

  -- New drivers without an assignment or conversation receive an available
  -- dispatcher, with the company administrator as the final fallback.
  if target_id is null then
    select p.id into target_id
    from public.profiles p
    where p.company_id = actor.company_id
      and p.status = 'active'
      and p.role in ('dispatcher', 'company_admin')
    order by case p.role when 'dispatcher' then 0 else 1 end,
             p.created_at,
             p.id
    limit 1;
  end if;

  if target_id is null then raise exception 'No dispatcher is available'; end if;
  return public.open_direct_chat(target_id);
end;
$$;

