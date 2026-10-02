-- GPS history is separate from presence: raw points are never published to
-- Realtime. One assignment owns one tracking session.
create table public.driver_tracking_sessions (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index driver_tracking_sessions_driver_idx
  on public.driver_tracking_sessions (driver_id, started_at desc);

create table public.driver_location_points (
  id uuid primary key,
  assignment_id uuid not null references public.driver_tracking_sessions(assignment_id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m between 0 and 200),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 100),
  heading_deg double precision check (heading_deg is null or heading_deg between 0 and 360),
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index driver_location_points_route_idx
  on public.driver_location_points (driver_id, load_id, captured_at, id);
create index driver_location_points_retention_idx
  on public.driver_location_points (captured_at);

alter table public.driver_tracking_sessions enable row level security;
alter table public.driver_location_points enable row level security;

create policy driver_tracking_sessions_read on public.driver_tracking_sessions
for select to authenticated
using (
  driver_id = (select auth.uid())
  or (company_id = public.current_company_id()
      and public.current_app_role() in ('company_admin', 'dispatcher')
      and public.can_access_driver(driver_id))
);

create policy driver_location_points_read on public.driver_location_points
for select to authenticated
using (
  driver_id = (select auth.uid())
  or (company_id = public.current_company_id()
      and public.current_app_role() in ('company_admin', 'dispatcher')
      and public.can_access_driver(driver_id))
);

grant select on public.driver_tracking_sessions, public.driver_location_points to authenticated;

create function public.current_driver_tracking_assignment()
returns table(assignment_id uuid, load_id uuid)
language plpgsql volatile security definer
set search_path = public
as $$
declare actor public.profiles := public.current_profile();
begin
  if actor.id is null or actor.role <> 'driver' or actor.status <> 'active' then
    raise exception 'Active driver permission required';
  end if;
  return query
  select a.id, a.load_id
  from public.assignments a
  join public.loads l on l.id = a.load_id
    and l.company_id = actor.company_id
    and l.current_assignment_id = a.id
  where a.driver_id = actor.id
    and a.company_id = actor.company_id
    and a.status = 'active'
    and a.driver_stage not in ('delivered', 'completed')
    and l.status in ('assigned', 'in_progress')
  order by a.assigned_at desc, a.id
  limit 1;
end;
$$;

create function public.ingest_driver_location_batch(
  target_assignment_id uuid,
  points jsonb
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.assignments;
  target_load public.loads;
  point jsonb;
  point_time timestamptz;
  count_inserted integer := 0;
  number_of_points integer;
  latest_live_time timestamptz;
  latest_live_point jsonb;
begin
  if actor.id is null or actor.role <> 'driver' or actor.status <> 'active' then
    raise exception 'Active driver permission required';
  end if;
  if jsonb_typeof(points) <> 'array' then
    raise exception 'Points must be an array';
  end if;
  number_of_points := jsonb_array_length(points);
  if number_of_points < 1 or number_of_points > 100 then
    raise exception 'Batch size must be between 1 and 100';
  end if;
  select * into target from public.assignments a
  where a.id = target_assignment_id
    and a.driver_id = actor.id
    and a.company_id = actor.company_id;
  if target.id is null then raise exception 'Tracking assignment denied'; end if;
  select * into target_load from public.loads l
  where l.id = target.load_id
    and l.company_id = actor.company_id;
  if target_load.id is null then
    raise exception 'Tracking load is no longer assigned';
  end if;
  if target.status = 'active' and target_load.current_assignment_id <> target.id then
    raise exception 'Tracking assignment is no longer current';
  end if;
  if target.status <> 'active' and target.ended_at is null then
    raise exception 'Tracking assignment has no end time';
  end if;

  insert into public.driver_tracking_sessions(
    assignment_id, company_id, driver_id, load_id, started_at, ended_at
  ) values (
    target.id, actor.company_id, actor.id, target.load_id,
    coalesce(target.accepted_at, target.assigned_at), target.ended_at
  )
  on conflict (assignment_id) do update
  set ended_at = excluded.ended_at;

  for point in select value from jsonb_array_elements(points)
  loop
    if jsonb_typeof(point) <> 'object'
      or jsonb_typeof(point->'id') <> 'string'
      or jsonb_typeof(point->'captured_at') <> 'string'
      or jsonb_typeof(point->'latitude') <> 'number'
      or jsonb_typeof(point->'longitude') <> 'number'
      or jsonb_typeof(point->'accuracy_m') <> 'number'
    then raise exception 'Invalid tracking point'; end if;
    point_time := (point->>'captured_at')::timestamptz;
    if point_time < coalesce(target.accepted_at, target.assigned_at) - interval '5 minutes'
      or point_time > coalesce(target.ended_at, now()) + interval '2 minutes'
    then
      -- A load may finish while the phone is offline. Discard samples after
      -- its end time, but acknowledge the batch so the local queue can drain.
      continue;
    end if;

    insert into public.driver_location_points(
      id, assignment_id, company_id, driver_id, load_id,
      latitude, longitude, accuracy_m, speed_mps, heading_deg, captured_at
    ) values (
      (point->>'id')::uuid, target.id, actor.company_id, actor.id, target.load_id,
      (point->>'latitude')::double precision,
      (point->>'longitude')::double precision,
      (point->>'accuracy_m')::double precision,
      case when point->'speed_mps' is null then null
        else (point->>'speed_mps')::double precision end,
      case when point->'heading_deg' is null then null
        else (point->>'heading_deg')::double precision end,
      point_time
    )
    on conflict (id) do nothing;
    if found then count_inserted := count_inserted + 1; end if;
    if point_time >= now() - interval '2 minutes'
      and (latest_live_time is null or point_time > latest_live_time)
    then
      latest_live_time := point_time;
      latest_live_point := point;
    end if;
  end loop;
  -- Reuse the successful batch to refresh the live marker without another
  -- request. Historic offline uploads must not masquerade as a live position.
  if target.status = 'active' and latest_live_point is not null then
    insert into public.driver_presence(
      driver_id, company_id, is_online, latitude, longitude,
      heading, speed_mph, last_seen_at
    ) values (
      actor.id, actor.company_id, true,
      (latest_live_point->>'latitude')::numeric,
      (latest_live_point->>'longitude')::numeric,
      (latest_live_point->>'heading_deg')::numeric,
      (latest_live_point->>'speed_mps')::numeric * 2.236936,
      now()
    )
    on conflict (driver_id) do update set
      is_online = true,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      heading = excluded.heading,
      speed_mph = excluded.speed_mph,
      last_seen_at = now(),
      updated_at = now();
  end if;
  return count_inserted;
end;
$$;

revoke all on function public.current_driver_tracking_assignment() from public, anon;
revoke all on function public.ingest_driver_location_batch(uuid, jsonb) from public, anon;
grant execute on function public.current_driver_tracking_assignment() to authenticated;
grant execute on function public.ingest_driver_location_batch(uuid, jsonb) to authenticated;

-- Keep raw GPS storage bounded. Supabase projects with pg_cron already enabled
-- get a daily cleanup job; otherwise the documented service-role job can call
-- this function after pg_cron is enabled in the project dashboard.
create function public.purge_driver_location_history()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.driver_location_points
  where captured_at < now() - interval '90 days';
  delete from public.driver_tracking_sessions s
  where s.started_at < now() - interval '90 days'
    and not exists (
      select 1 from public.driver_location_points p
      where p.assignment_id = s.assignment_id
    )
    and exists (
      select 1 from public.assignments a
      where a.id = s.assignment_id and a.status <> 'active'
    );
end;
$$;
revoke all on function public.purge_driver_location_history() from public, anon, authenticated;
grant execute on function public.purge_driver_location_history() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'driver-location-retention', '15 3 * * *',
      'select public.purge_driver_location_history()'
    );
  end if;
end;
$$;
