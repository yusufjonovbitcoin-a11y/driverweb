-- Dispatch and driver agree in chat. Assign a single driver atomically without
-- creating an offer or asking the driver to accept it in the mobile app.
create or replace function public.assign_load_directly(
  load_id uuid,
  driver_id uuid
)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  previous_assignment public.assignments;
  next_assignment public.assignments;
  latest_snapshot_id uuid;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;

  select * into target_load
  from public.loads l
  where l.id = load_id and l.company_id = actor.company_id
  for update;
  if target_load.id is null then
    raise exception 'Load not found';
  end if;
  if target_load.status not in ('ready_for_offer', 'offered', 'assigned', 'in_progress') then
    raise exception 'Load is not available for direct assignment';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = driver_id
      and p.company_id = actor.company_id
      and p.role = 'driver'
      and p.status = 'active'
  ) or not public.can_access_driver(driver_id) then
    raise exception 'Driver is not eligible';
  end if;

  if target_load.current_assignment_id is not null then
    select * into previous_assignment
    from public.assignments a
    where a.id = target_load.current_assignment_id
      and a.load_id = target_load.id
      and a.status = 'active'
    for update;
    if previous_assignment.id is null then
      raise exception 'Active assignment is inconsistent';
    end if;
    if previous_assignment.driver_id = driver_id then
      return previous_assignment;
    end if;
    update public.assignments
    set status = 'reassigned', ended_at = now()
    where id = previous_assignment.id;
  end if;

  select s.id into latest_snapshot_id
  from public.load_price_snapshots s
  where s.load_id = target_load.id
  order by s.created_at desc, s.id desc
  limit 1;

  insert into public.assignments (
    company_id, load_id, driver_id, assigned_by, status,
    accepted_price_snapshot_id, requires_reconfirmation, driver_stage
  ) values (
    actor.company_id, target_load.id, driver_id, actor.id, 'active',
    latest_snapshot_id, false,
    coalesce(previous_assignment.driver_stage, 'accepted')
  ) returning * into next_assignment;

  update public.offers
  set status = 'superseded', responded_at = now()
  where offers.load_id = target_load.id
    and offers.status in ('pending', 'missed_offline');

  update public.loads l
  set current_assignment_id = next_assignment.id,
      status = case
        when previous_assignment.id is null then 'assigned'::public.load_status
        else l.status
      end,
      version = l.version + 1
  where l.id = target_load.id;

  insert into public.notifications (
    company_id, recipient_id, type, title, body, entity_type, entity_id
  ) values (
    actor.company_id, driver_id, 'load_assigned', 'New load assigned',
    'Dispatch assigned load ' || target_load.load_number || ' to you.',
    'load', target_load.id
  );
  insert into public.audit_events (
    company_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    actor.company_id, actor.id, 'load.assigned_directly', 'load', target_load.id,
    case when previous_assignment.id is null then null else
      jsonb_build_object('assignmentId', previous_assignment.id, 'driverId', previous_assignment.driver_id)
    end,
    jsonb_build_object('assignmentId', next_assignment.id, 'driverId', driver_id)
  );
  return next_assignment;
end;
$$;

revoke all on function public.assign_load_directly(uuid, uuid) from public, anon;
grant execute on function public.assign_load_directly(uuid, uuid) to authenticated;
