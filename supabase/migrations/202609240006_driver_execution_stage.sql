-- Persist every driver-facing execution step. The macro load status remains the
-- dispatcher summary; driver_stage is the detailed mobile workflow.

alter table public.assignments
  add column driver_stage text not null default 'accepted'
  check (driver_stage in (
    'accepted', 'en_route_to_pickup', 'arrived_at_pickup', 'picked_up',
    'in_transit', 'arrived_at_delivery', 'delivered', 'completed'
  ));

create or replace function public.advance_driver_stage(
  load_id uuid,
  next_stage text,
  operation_id uuid,
  base_load_version bigint,
  occurred_at timestamptz default now(),
  latitude numeric default null,
  longitude numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  target_assignment public.assignments;
  target_stop public.load_stops;
  response_payload jsonb;
  allowed boolean := false;
begin
  select result into response_payload
  from public.client_operations
  where client_operations.operation_id = advance_driver_stage.operation_id
    and actor_id = (select auth.uid());
  if response_payload is not null then return response_payload; end if;

  if actor.id is null or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;

  select * into target_load
  from public.loads
  where id = load_id and company_id = actor.company_id
  for update;
  if target_load.id is null or target_load.version <> base_load_version then
    raise exception 'Load changed; refresh before retrying';
  end if;

  select * into target_assignment
  from public.assignments
  where id = target_load.current_assignment_id
    and driver_id = actor.id
    and status = 'active'
  for update;
  if target_assignment.id is null then
    raise exception 'This load is no longer assigned to you';
  end if;
  perform public.assert_assignment_confirmed(target_load.id, actor.id);

  allowed :=
    (target_assignment.driver_stage = 'accepted' and next_stage = 'en_route_to_pickup')
    or (target_assignment.driver_stage = 'en_route_to_pickup' and next_stage = 'arrived_at_pickup')
    or (target_assignment.driver_stage = 'arrived_at_pickup' and next_stage = 'picked_up')
    or (target_assignment.driver_stage = 'picked_up' and next_stage = 'in_transit')
    or (target_assignment.driver_stage = 'in_transit' and next_stage = 'arrived_at_delivery')
    or (target_assignment.driver_stage = 'arrived_at_delivery' and next_stage = 'delivered')
    or (target_assignment.driver_stage = 'delivered' and next_stage = 'completed');
  if not allowed then raise exception 'Invalid driver stage transition'; end if;

  if next_stage in ('arrived_at_pickup', 'picked_up') then
    select * into target_stop
    from public.load_stops
    where load_stops.load_id = target_load.id and type = 'pickup'
    for update;
    if next_stage = 'arrived_at_pickup' and target_stop.status <> 'pending' then
      raise exception 'Pickup arrival has already been recorded';
    end if;
    if next_stage = 'picked_up' and target_stop.status <> 'arrived' then
      raise exception 'Pickup arrival must be recorded first';
    end if;
    if next_stage = 'picked_up' and target_stop.requires_document and not exists (
      select 1 from public.documents d
      where d.stop_id = target_stop.id and d.current_version_id is not null
    ) then raise exception 'Required pickup document is missing'; end if;

    update public.load_stops
    set status = case when next_stage = 'arrived_at_pickup' then 'arrived'::public.stop_status else 'done'::public.stop_status end,
        version = version + 1
    where id = target_stop.id;
  elsif next_stage in ('arrived_at_delivery', 'delivered') then
    select * into target_stop
    from public.load_stops
    where load_stops.load_id = target_load.id and type = 'delivery'
    for update;
    if next_stage = 'arrived_at_delivery' and target_stop.status <> 'pending' then
      raise exception 'Delivery arrival has already been recorded';
    end if;
    if next_stage = 'delivered' and target_stop.status <> 'arrived' then
      raise exception 'Delivery arrival must be recorded first';
    end if;
    if next_stage = 'delivered' and target_stop.requires_document and not exists (
      select 1 from public.documents d
      where d.stop_id = target_stop.id and d.current_version_id is not null
    ) then raise exception 'Required delivery document is missing'; end if;

    update public.load_stops
    set status = case when next_stage = 'arrived_at_delivery' then 'arrived'::public.stop_status else 'done'::public.stop_status end,
        version = version + 1
    where id = target_stop.id;
  end if;

  update public.assignments
  set driver_stage = next_stage,
      status = case when next_stage = 'completed' then 'completed'::public.assignment_status else status end,
      ended_at = case when next_stage = 'completed' then now() else ended_at end
  where id = target_assignment.id;

  update public.loads
  set status = case
        when next_stage in ('arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_delivery') then 'in_progress'::public.load_status
        when next_stage = 'delivered' then 'delivered'::public.load_status
        when next_stage = 'completed' then 'completed'::public.load_status
        else status
      end,
      version = version + 1
  where id = target_load.id;

  if latitude is not null and longitude is not null then
    insert into public.location_snapshots(
      company_id, driver_id, load_id, event_type, latitude, longitude, captured_at
    ) values (
      actor.company_id, actor.id, target_load.id, concat('driver.', next_stage),
      latitude, longitude, occurred_at
    );
  end if;

  response_payload := jsonb_build_object(
    'loadId', target_load.id,
    'assignmentId', target_assignment.id,
    'stage', next_stage
  );
  insert into public.client_operations(
    operation_id, company_id, actor_id, load_id, command_type, base_version,
    payload, occurred_at, received_at, status, result, error_message
  ) values (
    operation_id, actor.company_id, actor.id, target_load.id,
    'advance_driver_stage', base_load_version,
    jsonb_build_object('nextStage', next_stage), occurred_at, now(),
    'accepted', response_payload, null
  );
  insert into public.audit_events(
    company_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    actor.company_id, actor.id, 'assignment.stage_advanced',
    'assignment', target_assignment.id, response_payload
  );
  return response_payload;
end;
$$;

revoke all on function public.advance_driver_stage(uuid, text, uuid, bigint, timestamptz, numeric, numeric)
  from public, anon;
grant execute on function public.advance_driver_stage(uuid, text, uuid, bigint, timestamptz, numeric, numeric)
  to authenticated;
