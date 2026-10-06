-- Ordered multi-stop execution. Every mutation is ownership-checked, versioned,
-- idempotent and locked on the load; completing one stop never completes others.
-- Staff-authored operational instructions are deliberately separate from raw
-- broker text, which can contain freight charges and payment terms.
alter table public.loads add column driver_instructions text;
create function public.save_driver_instructions(target_load_id uuid, expected_version bigint, instructions text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); target public.loads;
begin
  if actor.id is null or actor.status<>'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'Staff permission required'; end if;
  select * into target from public.loads where id=target_load_id and company_id=actor.company_id for update;
  if target.id is null or not public.can_access_load(target.id) then raise exception 'Load not found'; end if;
  if target.trashed_at is not null then raise exception 'Load is in trash'; end if;
  if target.version is distinct from expected_version then raise exception 'Load changed; refresh before retrying'; end if;
  if length(instructions)>12000 then raise exception 'Instructions too long'; end if;
  update public.loads set driver_instructions=nullif(btrim(instructions),''),version=version+1
    where id=target.id returning * into target;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(actor.company_id,actor.id,'load.driver_instructions_updated','load',target.id,
      jsonb_build_object('version',target.version));
  return jsonb_build_object('version',target.version,'driver_instructions',target.driver_instructions);
end $$;
revoke all on function public.save_driver_instructions(uuid,bigint,text) from public,anon;
grant execute on function public.save_driver_instructions(uuid,bigint,text) to authenticated;
do $$ declare body text; begin
  body := pg_get_functiondef('public.get_driver_load_rows(uuid[])'::regprocedure);
  if position('''special_instructions'',null' in body)=0 then raise exception 'Expected driver pay projection missing'; end if;
  body := replace(body, '''special_instructions'',null','''special_instructions'',l.driver_instructions');
  execute body;
end $$;

create function public.get_driver_analytics_in_zone(period_start timestamptz, period_end timestamptz, report_time_zone text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous_zone text := current_setting('TimeZone'); result jsonb;
begin
  if report_time_zone is null or report_time_zone <> all(array['America/New_York','America/Chicago',
    'America/Denver','America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu']) then
    raise exception 'Unsupported report time zone';
  end if;
  perform set_config('TimeZone',report_time_zone,true);
  result := public.get_driver_analytics(period_start,period_end);
  perform set_config('TimeZone',previous_zone,true);
  return result;
end $$;
revoke all on function public.get_driver_analytics_in_zone(timestamptz,timestamptz,text) from public,anon;
grant execute on function public.get_driver_analytics_in_zone(timestamptz,timestamptz,text) to authenticated;

create function public.advance_driver_route(
  load_id uuid, next_stage text, operation_id uuid, base_load_version bigint,
  occurred_at timestamptz default now(), latitude numeric default null,
  longitude numeric default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles := public.current_profile();
  l public.loads; a public.assignments; s public.load_stops; following public.load_stops;
  result jsonb; previous_operation public.client_operations; stage text; required_type text;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'driver' then
    raise exception 'Active driver required'; end if;
  select * into l from public.loads where id=load_id and company_id=actor.company_id for update;
  if l.id is null or l.trashed_at is not null then raise exception 'Load unavailable'; end if;
  if operation_id is null then raise exception 'Operation ID is required'; end if;
  select * into a from public.assignments where id=l.current_assignment_id
    and driver_id=actor.id for update;
  if a.id is null then raise exception 'Load is no longer assigned to you'; end if;
  select co.* into previous_operation from public.client_operations co
    where co.operation_id=advance_driver_route.operation_id and co.actor_id=actor.id
      and co.load_id=l.id;
  if previous_operation.operation_id is not null then
    if previous_operation.command_type is distinct from 'advance_driver_stage'
      or previous_operation.payload->>'nextStage' is distinct from next_stage
      or previous_operation.result->>'assignmentId' is distinct from a.id::text then
      raise exception 'Operation ID belongs to another action or assignment';
    end if;
    return previous_operation.result;
  end if;
  if a.status<>'active' then raise exception 'Load is no longer assigned to you'; end if;
  if l.version is distinct from base_load_version then raise exception 'Load changed; refresh before retrying'; end if;
  perform public.assert_assignment_confirmed(l.id, actor.id);
  select * into s from public.load_stops where load_stops.load_id=l.id and status<>'done'
    and (status<>'skipped' or requires_document)
    order by sequence,id limit 1 for update;
  if next_stage='completed' then
    if s.id is not null or a.driver_stage<>'delivered' then
      raise exception 'Complete every stop before completing the load'; end if;
    stage := 'completed';
  elsif s.id is null then raise exception 'No pending stop';
  elsif next_stage='en_route_to_pickup' and a.driver_stage='accepted' then
    stage := case when s.type='pickup' then 'en_route_to_pickup' else 'in_transit' end;
  elsif (next_stage='arrived_at_pickup' and s.type='pickup' and a.driver_stage='en_route_to_pickup')
     or (next_stage='arrived_at_delivery' and s.type='delivery' and a.driver_stage='in_transit') then
    -- An optional stop explicitly skipped by staff is terminal. A skipped stop
    -- requiring evidence remains unfinished and can be revisited; skipping never
    -- waives a required BOL/POD or rewrites historical stop/document records.
    if s.status not in ('pending','arrived','skipped') then raise exception 'Invalid stop arrival'; end if;
    update public.load_stops set status='arrived',version=version+1 where id=s.id;
    stage := next_stage;
  elsif (next_stage='picked_up' and s.type='pickup' and a.driver_stage='arrived_at_pickup')
     or (next_stage='delivered' and s.type='delivery' and a.driver_stage='arrived_at_delivery') then
    if s.status<>'arrived' then raise exception 'Record arrival first'; end if;
    required_type := case when s.type='pickup' then 'bol' else 'pod' end;
    if s.requires_document and not exists (
      select 1 from public.documents d join public.document_versions v on v.id=d.current_version_id
      where d.stop_id=s.id and d.document_type::text=required_type
        and (l.execution_reset_at is null or v.uploaded_at>=l.execution_reset_at)
    ) then raise exception 'Required stop document is missing'; end if;
    update public.load_stops set status='done',version=version+1 where id=s.id;
    select * into following from public.load_stops where load_stops.load_id=l.id and status<>'done'
      and (status<>'skipped' or requires_document)
      order by sequence,id limit 1;
    stage := case when following.id is null then 'delivered'
                  when following.type='pickup' then 'en_route_to_pickup' else 'in_transit' end;
  else raise exception 'Invalid driver stage transition'; end if;
  update public.assignments set driver_stage=stage,
    status=case when stage='completed' then 'completed'::public.assignment_status else status end,
    ended_at=case when stage='completed' then now() else ended_at end where id=a.id;
  update public.loads set status=case when stage='completed' then 'completed'::public.load_status
    when stage='delivered' then 'delivered'::public.load_status else 'in_progress'::public.load_status end,
    version=version+1 where id=l.id;
  if latitude is not null and longitude is not null then
    insert into public.location_snapshots(company_id,driver_id,load_id,event_type,latitude,longitude,captured_at)
      values(actor.company_id,actor.id,l.id,concat('driver.',next_stage),latitude,longitude,occurred_at);
  end if;
  result := jsonb_build_object('loadId',l.id,'assignmentId',a.id,'stopId',s.id,'stage',stage);
  insert into public.client_operations(operation_id,company_id,actor_id,load_id,command_type,
    base_version,payload,occurred_at,received_at,status,result)
    values(operation_id,actor.company_id,actor.id,l.id,'advance_driver_stage',base_load_version,
      jsonb_build_object('nextStage',next_stage,'stopId',s.id),occurred_at,now(),'accepted',result);
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(actor.company_id,actor.id,'assignment.stop_advanced','assignment',a.id,result);
  return result;
end $$;
revoke all on function public.advance_driver_route(uuid,text,uuid,bigint,timestamptz,numeric,numeric) from public,anon;
grant execute on function public.advance_driver_route(uuid,text,uuid,bigint,timestamptz,numeric,numeric) to authenticated;

-- Upgrade active legacy multi-stop journeys without pretending an unvisited
-- pickup/delivery was completed. The former global stage may already be picked_up,
-- in_transit or delivered while an earlier stop is still pending. Preserve every
-- stop and document, derive the next actionable stage, and invalidate stale queued
-- versions. Finished/historical assignments and trash are deliberately untouched.
create function private.reconcile_driver_route(target_load_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.loads; a public.assignments; s public.load_stops;
  reconciled_stage text; reconciled_status public.load_status;
begin
    select * into l from public.loads where id=target_load_id for update;
    if l.id is null or l.trashed_at is not null
      or (select count(*) from public.load_stops where load_id=l.id)<=2 then return; end if;
    select * into a from public.assignments where id=l.current_assignment_id and status='active' for update;
    if a.id is null then return; end if;
    select * into s from public.load_stops where load_id=l.id and status<>'done'
      and (status<>'skipped' or requires_document) order by sequence,id limit 1;
    reconciled_stage := case
      when s.id is null then 'delivered'
      when s.status='arrived' and s.type='pickup' then 'arrived_at_pickup'
      when s.status='arrived' then 'arrived_at_delivery'
      when a.driver_stage='accepted' then 'accepted'
      when s.type='pickup' then 'en_route_to_pickup'
      else 'in_transit' end;
    reconciled_status := case when reconciled_stage='delivered' then 'delivered'::public.load_status
      when reconciled_stage='accepted' then l.status else 'in_progress'::public.load_status end;
    if a.driver_stage is distinct from reconciled_stage or l.status is distinct from reconciled_status then
      update public.assignments set driver_stage=reconciled_stage where id=a.id;
      update public.loads set version=version+1,status=reconciled_status where id=l.id;
      insert into public.audit_events(company_id,action,entity_type,entity_id,old_value,new_value)
        values(l.company_id,'assignment.route_reconciled','assignment',a.id,
          jsonb_build_object('stage',a.driver_stage,'loadVersion',l.version,'loadStatus',l.status),
          jsonb_build_object('stage',reconciled_stage,'loadVersion',l.version+1,'stopId',s.id,'loadStatus',reconciled_status));
    end if;
end $$;
revoke all on function private.reconcile_driver_route(uuid) from public,anon,authenticated;
do $$ declare target uuid; begin
  for target in select x.id from public.loads x where x.trashed_at is null
    and exists(select 1 from public.assignments y where y.id=x.current_assignment_id and y.status='active')
    and (select count(*) from public.load_stops z where z.load_id=x.id)>2 order by x.id
  loop
    perform private.reconcile_driver_route(target);
  end loop;
end $$;

-- Older clients must not use the one-pickup/one-delivery routine to skip stops.
do $$ declare body text; begin
  body := pg_get_functiondef('public.advance_driver_stage(uuid,text,uuid,bigint,timestamptz,numeric,numeric)'::regprocedure);
  body := regexp_replace(body, E'begin\\n', E'begin\n  if (select count(*) from public.load_stops s where s.load_id=advance_driver_stage.load_id)>2 then\n    return public.advance_driver_route(load_id,next_stage,operation_id,base_load_version,occurred_at,latitude,longitude);\n  end if;\n');
  execute body;
end $$;

-- The legacy per-stop endpoint must not allow a mobile client to skip the
-- ordered route or finish the load on its first delivery.
do $$ declare body text; begin
  body := pg_get_functiondef('public.transition_stop(uuid,public.stop_status,uuid,bigint,timestamptz,numeric,numeric)'::regprocedure);
  body := replace(body, E'begin\n', E'begin\n  if actor.role=''driver'' and (select count(*) from public.load_stops s where s.load_id=(select t.load_id from public.load_stops t where t.id=transition_stop.stop_id))>2 then\n    raise exception ''Use the ordered route workflow for multiple stops'';\n  end if;\n');
  if position('  if actor.role = ''driver'' and latitude is not null' in body)=0 then
    raise exception 'Expected stop transition reconciliation point missing'; end if;
  body := replace(body, '  if actor.role = ''driver'' and latitude is not null',
    E'  perform private.reconcile_driver_route(target_load.id);\n\n  if actor.role = ''driver'' and latitude is not null');
  execute body;
end $$;
