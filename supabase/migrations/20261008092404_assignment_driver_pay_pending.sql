-- Missing live GPS must not prevent dispatch. Keep unresolved compensation
-- separate from immutable, fully calculated snapshots. No historical backfill.
create table public.assignment_driver_pay_pending (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  rate_per_mile numeric(10,4) not null check (rate_per_mile > 0 and rate_per_mile <= 100),
  currency text not null default 'USD' check (currency = 'USD'),
  distance_basis text not null default 'deadhead_and_loaded' check (distance_basis = 'deadhead_and_loaded'),
  route_fingerprint text not null,
  created_at timestamptz not null default now()
);
comment on table public.assignment_driver_pay_pending is
  'Assignment-time frozen rate; distances and compensation remain unknown until verified. Never infer departure from a later GPS fix.';
create index assignment_driver_pay_pending_driver_load_idx
  on public.assignment_driver_pay_pending(driver_id,load_id);
create index assignment_driver_pay_pending_company_idx on public.assignment_driver_pay_pending(company_id);
create index assignment_driver_pay_pending_load_idx on public.assignment_driver_pay_pending(load_id);
alter table public.assignment_driver_pay_pending enable row level security;
revoke all on public.assignment_driver_pay_pending from public,anon,authenticated;
grant select on public.assignment_driver_pay_pending to authenticated;
grant all on public.assignment_driver_pay_pending to service_role;
create policy assignment_driver_pay_pending_read on public.assignment_driver_pay_pending
  for select to authenticated using (
    (select public.current_app_role()) is not null
    and company_id=(select public.current_company_id())
    and (driver_id=(select auth.uid())
      or (public.is_privileged_member() and public.can_access_driver(driver_id)))
  );
create trigger assignment_driver_pay_pending_immutable
  before update on public.assignment_driver_pay_pending
  for each row execute function private.immutable_driver_pay();

-- All future mileage-paid assignments freeze only the rate. Assignment-time
-- quotes/presence cannot determine departure. Existing finalized rows stay intact.
create or replace function private.freeze_driver_pay() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rate numeric;
begin
  perform 1 from public.profiles where id=new.driver_id for update;
  select rate_per_mile into rate from public.driver_pay_settings where driver_id=new.driver_id;
  delete from private.driver_pay_quotes where load_id=new.load_id and driver_id=new.driver_id;
  if rate is null then return new; end if;
  insert into public.assignment_driver_pay_pending(assignment_id,load_id,driver_id,company_id,
    rate_per_mile,route_fingerprint)
  values(new.id,new.load_id,new.driver_id,new.company_id,rate,private.pay_route_fingerprint(new.load_id));
  return new;
end $$;
revoke all on function private.freeze_driver_pay() from public,anon,authenticated;

-- Private immutable START evidence; never replace it with later presence.
create table private.driver_pay_start_origins (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  operation_id uuid not null unique,
  base_load_version bigint not null,
  latitude numeric not null check(latitude between -90 and 90),
  longitude numeric not null check(longitude between -180 and 180),
  captured_at timestamptz not null,
  accuracy numeric not null check(accuracy between 0 and 100),
  stops jsonb not null check(jsonb_typeof(stops)='array' and jsonb_array_length(stops)>=2),
  route_fingerprint text not null,
  result jsonb not null,
  started_at timestamptz not null default now()
);
create index driver_pay_start_origins_load_idx on private.driver_pay_start_origins(load_id);
alter table private.driver_pay_start_origins enable row level security;
revoke all on private.driver_pay_start_origins from public,anon,authenticated,service_role;
create trigger driver_pay_start_origins_immutable before update on private.driver_pay_start_origins
  for each row execute function private.immutable_driver_pay();

-- The invariant is at the stage write, covering both old START RPCs without a
-- client-settable bypass flag. Cancellation/trash is not a trip START.
create function private.require_driver_pay_start_origin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.driver_stage='accepted' and new.driver_stage is distinct from old.driver_stage
    and new.status in ('active','completed')
    and exists(select 1 from public.assignment_driver_pay_pending where assignment_id=new.id)
    and not exists(select 1 from private.driver_pay_start_origins o where o.assignment_id=new.id
      and o.load_id=new.load_id and o.driver_id=new.driver_id and o.company_id=new.company_id)
  then raise exception 'DRIVER_PAY_START_GPS_REQUIRED'; end if;
  return new;
end $$;
revoke all on function private.require_driver_pay_start_origin() from public,anon,authenticated;
create trigger require_driver_pay_start_origin before update of driver_stage on public.assignments
  for each row execute function private.require_driver_pay_start_origin();

create function public.start_driver_load_with_pay(
  p_load_id uuid,p_operation_id uuid,p_base_load_version bigint,p_captured_at timestamptz,
  p_latitude numeric,p_longitude numeric,p_accuracy numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); l public.loads; a public.assignments;
  pending public.assignment_driver_pay_pending; origin private.driver_pay_start_origins;
  result jsonb; route jsonb; fingerprint text; first_pending public.load_stops;
begin
  if actor.id is null or actor.status<>'active' or actor.role<>'driver' then
    raise exception 'DRIVER_PAY_START_PERMISSION_DENIED'; end if;
  select * into l from public.loads where id=p_load_id and company_id=actor.company_id for update;
  if l.id is null or l.trashed_at is not null then raise exception 'DRIVER_PAY_START_LOAD_UNAVAILABLE'; end if;
  select * into a from public.assignments where id=l.current_assignment_id and driver_id=actor.id for update;
  if a.id is null then raise exception 'DRIVER_PAY_START_ASSIGNMENT_CHANGED'; end if;
  if p_operation_id is null then raise exception 'DRIVER_PAY_START_OPERATION_REQUIRED'; end if;
  select * into origin from private.driver_pay_start_origins where operation_id=p_operation_id;
  if origin.assignment_id is not null then
    if origin.assignment_id<>a.id or origin.load_id<>l.id or origin.driver_id<>actor.id
      or origin.base_load_version is distinct from p_base_load_version
      or origin.captured_at is distinct from p_captured_at or origin.latitude is distinct from p_latitude
      or origin.longitude is distinct from p_longitude or origin.accuracy is distinct from p_accuracy then
      raise exception 'DRIVER_PAY_START_OPERATION_CONFLICT'; end if;
    if a.status not in ('active','completed') then raise exception 'DRIVER_PAY_START_ASSIGNMENT_CHANGED'; end if;
    return origin.result;
  end if;
  if exists(select 1 from public.client_operations where operation_id=p_operation_id)
    or exists(select 1 from private.driver_pay_start_origins where assignment_id=a.id) then
    raise exception 'DRIVER_PAY_START_OPERATION_CONFLICT'; end if;
  if a.status<>'active' or a.driver_stage<>'accepted' then raise exception 'DRIVER_PAY_START_ALREADY_STARTED'; end if;
  if l.version is distinct from p_base_load_version then raise exception 'DRIVER_PAY_START_VERSION_CONFLICT'; end if;
  select * into pending from public.assignment_driver_pay_pending where assignment_id=a.id;
  if pending.assignment_id is null then
    return public.advance_driver_stage(l.id,'en_route_to_pickup',p_operation_id,
      p_base_load_version,coalesce(p_captured_at,now()),p_latitude,p_longitude);
  end if;
  if p_captured_at is null or p_captured_at<=now()-interval '2 minutes'
    or p_captured_at>now()+interval '30 seconds'
    or p_latitude is null or p_latitude::text in ('NaN','Infinity','-Infinity') or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude::text in ('NaN','Infinity','-Infinity') or p_longitude not between -180 and 180
    or p_accuracy is null or p_accuracy::text in ('NaN','Infinity','-Infinity') or p_accuracy not between 0 and 100 then
    raise exception 'DRIVER_PAY_START_GPS_REQUIRED'; end if;
  perform public.assert_assignment_confirmed(l.id,actor.id);
  perform 1 from public.load_stops where load_id=l.id order by sequence,id for update;
  select jsonb_agg(to_jsonb(s) order by s.sequence,s.id) into route from public.load_stops s where s.load_id=l.id;
  if route is null or jsonb_array_length(route)<2 or jsonb_array_length(route)>25
    or route->0->>'type'<>'pickup' or route->-1->>'type'<>'delivery'
    or not exists(select 1 from public.load_stops where load_id=l.id and type='delivery') then
    raise exception 'DRIVER_PAY_START_ROUTE_INVALID'; end if;
  select * into first_pending from public.load_stops where load_id=l.id and status<>'done'
    and (status<>'skipped' or requires_document) order by sequence,id limit 1;
  if first_pending.id is null or first_pending.type<>'pickup' then
    raise exception 'DRIVER_PAY_START_ROUTE_INVALID'; end if;
  fingerprint:=private.pay_route_fingerprint(l.id);
  result:=jsonb_build_object('loadId',l.id,'assignmentId',a.id,'stage','en_route_to_pickup','stopId',first_pending.id,
    'operationId',p_operation_id,'driverPayStatus','pending','payCalculationQueued',true);
  insert into private.driver_pay_start_origins(assignment_id,load_id,driver_id,company_id,operation_id,
    base_load_version,latitude,longitude,captured_at,accuracy,stops,route_fingerprint,result)
  values(a.id,l.id,actor.id,actor.company_id,p_operation_id,p_base_load_version,p_latitude,p_longitude,
    p_captured_at,p_accuracy,route,fingerprint,result);
  -- Guard sees the immutable origin; a stage error rolls the entire START back.
  perform public.advance_driver_stage(l.id,'en_route_to_pickup',p_operation_id,
    p_base_load_version,p_captured_at,p_latitude,p_longitude);
  insert into public.jobs(company_id,type,idempotency_key,payload,max_attempts)
  values(a.company_id,'driver.pay_calculation','driver.pay_calculation:'||a.id,
    jsonb_build_object('assignmentId',a.id),8);
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
  values(a.company_id,actor.id,'driver.pay_start_captured','assignment',a.id,
    jsonb_build_object('operationId',p_operation_id,'capturedAt',p_captured_at,'ratePerMile',pending.rate_per_mile));
  return result;
end $$;
revoke all on function public.start_driver_load_with_pay(uuid,uuid,bigint,timestamptz,numeric,numeric,numeric) from public,anon;
grant execute on function public.start_driver_load_with_pay(uuid,uuid,bigint,timestamptz,numeric,numeric,numeric) to authenticated;

create function public.claim_driver_pay_calculation(p_worker_id text,p_assignment_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate public.jobs; job public.jobs; origin private.driver_pay_start_origins;
  l public.loads; a public.assignments;
begin
  if p_worker_id is null or length(btrim(p_worker_id))<8 or length(p_worker_id)>200 then
    raise exception 'DRIVER_PAY_WORKER_ID_INVALID'; end if;
  for candidate in select j.* from public.jobs j where j.type='driver.pay_calculation'
    and (p_assignment_id is null or j.payload->>'assignmentId'=p_assignment_id::text)
    and ((j.status in ('pending','failed') and j.available_at<=now())
      or (j.status='processing' and j.locked_at<now()-interval '2 minutes'))
    order by j.available_at,j.created_at,j.id limit 20
  loop
    select * into origin from private.driver_pay_start_origins where assignment_id=(candidate.payload->>'assignmentId')::uuid;
    if origin.assignment_id is null then
      update public.jobs set status='dead_letter',locked_at=null,locked_by=null,
        last_error='Pay calculation no longer eligible',updated_at=now() where id=candidate.id
        and ((status in ('pending','failed') and available_at<=now())
          or (status='processing' and locked_at<now()-interval '2 minutes'));
      continue;
    end if;
    -- Same lock order as START/trash/finalize; jobs are not held while waiting
    -- for a parent load, and concurrent workers skip rather than wait.
    select * into l from public.loads where id=origin.load_id for update skip locked;
    if l.id is null then continue; end if;
    select * into a from public.assignments where id=origin.assignment_id for update skip locked;
    if a.id is null then continue; end if;
    select * into job from public.jobs where id=candidate.id and type='driver.pay_calculation'
      and ((status in ('pending','failed') and available_at<=now())
        or (status='processing' and locked_at<now()-interval '2 minutes')) for update skip locked;
    if job.id is null then continue; end if;
    if job.company_id<>origin.company_id or a.company_id<>origin.company_id
      or a.driver_id<>origin.driver_id or a.load_id<>origin.load_id
      or a.status not in ('active','completed') or l.current_assignment_id is distinct from a.id
      or l.trashed_at is not null or origin.route_fingerprint<>private.pay_route_fingerprint(l.id)
      or not exists(select 1 from public.assignment_driver_pay_pending p where p.assignment_id=a.id
        and p.company_id=a.company_id and p.load_id=a.load_id and p.driver_id=a.driver_id)
      or job.attempt_count>=job.max_attempts then
      update public.jobs set status='dead_letter',last_error='Pay calculation no longer eligible',
        locked_at=null,locked_by=null,updated_at=now() where id=job.id;
      continue;
    end if;
    update public.jobs set status='processing',attempt_count=attempt_count+1,
      locked_at=now(),locked_by=p_worker_id,last_error=null,updated_at=now() where id=job.id;
    return jsonb_build_object('jobId',job.id,'assignmentId',a.id,'driverId',a.driver_id,'loadId',l.id,
      'origin',jsonb_build_object('latitude',origin.latitude,'longitude',origin.longitude,
        'capturedAt',origin.captured_at,'accuracy',origin.accuracy),'stops',origin.stops);
  end loop;
  return null;
end $$;
revoke all on function public.claim_driver_pay_calculation(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_driver_pay_calculation(text,uuid) to service_role;

create function public.finish_driver_pay_calculation(
  p_job_id uuid,p_worker_id text,p_loaded_miles numeric,p_deadhead_miles numeric,
  p_provider text,p_failed boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare job public.jobs; origin private.driver_pay_start_origins; l public.loads;
  a public.assignments; pending public.assignment_driver_pay_pending; existing public.assignment_driver_pay;
begin
  select * into job from public.jobs where id=p_job_id and type='driver.pay_calculation';
  if job.id is null then return false; end if;
  select * into origin from private.driver_pay_start_origins where assignment_id=(job.payload->>'assignmentId')::uuid;
  if origin.assignment_id is null then return false; end if;
  select * into l from public.loads where id=origin.load_id for update;
  select * into a from public.assignments where id=origin.assignment_id for update;
  select * into job from public.jobs where id=p_job_id for update;
  if job.status<>'processing' or job.locked_by is distinct from p_worker_id
    or job.locked_at is null or job.locked_at<now()-interval '2 minutes' then return false; end if;
  select * into pending from public.assignment_driver_pay_pending where assignment_id=a.id for update;
  if l.id is null or a.id is null or job.company_id<>origin.company_id or a.company_id<>origin.company_id
    or a.driver_id<>origin.driver_id or a.load_id<>origin.load_id
    or a.status not in ('active','completed') or l.current_assignment_id is distinct from a.id
    or l.trashed_at is not null or origin.route_fingerprint<>private.pay_route_fingerprint(l.id)
    or pending.assignment_id is null or pending.company_id<>a.company_id
    or pending.load_id<>a.load_id or pending.driver_id<>a.driver_id then
    update public.jobs set status='dead_letter',last_error='Pay calculation no longer eligible',
      locked_at=null,locked_by=null,updated_at=now() where id=job.id;
    return false;
  end if;
  if p_failed then
    update public.jobs set status=case when attempt_count>=max_attempts then 'dead_letter'::public.job_status else 'failed'::public.job_status end,
      available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempt_count,7))::integer)),
      locked_at=null,locked_by=null,last_error='Route provider unavailable',updated_at=now() where id=job.id;
    return true;
  end if;
  if p_loaded_miles is null or p_deadhead_miles is null
    or p_loaded_miles::text in ('NaN','Infinity','-Infinity') or p_deadhead_miles::text in ('NaN','Infinity','-Infinity')
    or p_loaded_miles<=0 or p_loaded_miles>1000000 or p_deadhead_miles<0 or p_deadhead_miles>1000000
    or p_loaded_miles<>round(p_loaded_miles,2) or p_deadhead_miles<>round(p_deadhead_miles,2)
    or p_provider is null or p_provider not in ('mapbox','google_routes') then
    raise exception 'DRIVER_PAY_ROUTE_RESULT_INVALID'; end if;
  insert into public.assignment_driver_pay(assignment_id,load_id,driver_id,company_id,rate_per_mile,
    loaded_miles,deadhead_miles,route_fingerprint,origin_latitude,origin_longitude,location_at,provider)
  values(a.id,a.load_id,a.driver_id,a.company_id,pending.rate_per_mile,p_loaded_miles,p_deadhead_miles,
    origin.route_fingerprint,origin.latitude,origin.longitude,origin.captured_at,p_provider)
  returning * into existing;
  delete from public.assignment_driver_pay_pending where assignment_id=a.id;
  update public.assignments set load_revision=load_revision+1 where id=a.id;
  update public.jobs set status='completed',locked_at=null,locked_by=null,last_error=null,updated_at=now() where id=job.id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
  values(a.company_id,null,'driver.pay_calculated','assignment',a.id,
    jsonb_build_object('rate_per_mile',existing.rate_per_mile,'loaded_miles',existing.loaded_miles,
      'deadhead_miles',existing.deadhead_miles,'amount',existing.amount,'provider',p_provider,
      'startOperationId',origin.operation_id));
  return true;
end $$;
revoke all on function public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean) to service_role;

-- All restrictive policies for raw loads, Rate Con, prices, files, chat links
-- and document checks already share this predicate. Pending pay must protect
-- those same surfaces even if the profile setting later changes.
create or replace function private.hide_broker_terms(p_load_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role()='driver' and (
    exists(select 1 from public.driver_pay_settings s
      where s.driver_id=(select auth.uid()) and s.hide_rate_con)
    or exists(select 1 from public.assignment_driver_pay p where p.assignment_id=(
      select a.id from public.assignments a where a.driver_id=(select auth.uid()) and a.load_id=p_load_id
      order by a.assigned_at desc,a.id desc limit 1))
    or exists(select 1 from public.assignment_driver_pay_pending p where p.assignment_id=(
      select a.id from public.assignments a where a.driver_id=(select auth.uid()) and a.load_id=p_load_id
      order by a.assigned_at desc,a.id desc limit 1))
  ),false);
$$;
revoke all on function private.hide_broker_terms(uuid) from public,anon;
grant execute on function private.hide_broker_terms(uuid) to authenticated;

-- Patch the installed projection, preserving operational stop facts, reviewed
-- driver instructions, current authorization and its READ ONLY transaction mode.
do $migration$
declare definition text:=pg_get_functiondef('public.get_driver_load_rows(uuid[])'::regprocedure);
begin
  if strpos(definition,'pay public.assignment_driver_pay;')=0
    or strpos(definition,'hidden:=private.hide_broker_terms(l.id);')=0
    or strpos(definition,'''broker_rate'',coalesce(pay.amount,0)')=0
    or strpos(definition,'''broker_terms_hidden'',hidden,')=0 then
    raise exception 'Unexpected pending-pay load projection';
  end if;
  definition:=replace(definition,'pay public.assignment_driver_pay;',
    'pay public.assignment_driver_pay; pending public.assignment_driver_pay_pending;');
  definition:=replace(definition,'hidden:=private.hide_broker_terms(l.id);',$patch$
    select p.* into pending from public.assignment_driver_pay_pending p
      where p.assignment_id=(select a.id from public.assignments a
        where a.load_id=l.id and a.driver_id=actor.id order by a.assigned_at desc,a.id desc limit 1);
    hidden:=private.hide_broker_terms(l.id);$patch$);
  definition:=replace(definition,'''broker_rate'',coalesce(pay.amount,0)',
    '''broker_rate'',case when pay.assignment_id is null and pending.assignment_id is not null then null else coalesce(pay.amount,0) end');
  definition:=replace(definition,'''broker_terms_hidden'',hidden,',$patch$'broker_terms_hidden',hidden,
      'driver_pay_status',case when pay.assignment_id is not null then 'ready' when pending.assignment_id is not null then 'pending' else null end,
      'driver_rate_per_mile',coalesce(pay.rate_per_mile,pending.rate_per_mile),$patch$);
  execute definition;
end $migration$;

-- Pay/privacy-protected loads use assignment revisions as the realtime signal.
do $migration$
declare definition text:=pg_get_functiondef('private.notify_driver_load_revision()'::regprocedure);
  original text:='exists(select 1 from public.assignment_driver_pay where assignment_id=new.current_assignment_id)';
begin
  if strpos(definition,original)=0 then raise exception 'Unexpected driver revision predicate'; end if;
  execute replace(definition,original,'('||original||
    ' or exists(select 1 from public.assignment_driver_pay_pending where assignment_id=new.current_assignment_id))');
end $migration$;

-- No broker fallback for pending assignments (including historical reassignment
-- rows). Known-only aggregate sums remain compatible; explicit pending counts
-- prevent clients treating those sums as a settled total. Pending per-trip
-- distances/amounts are NULL, never zero or a broker/offer estimate.
do $migration$
declare definition text:=pg_get_functiondef('public.get_driver_analytics(timestamptz,timestamptz)'::regprocedure);
  gross text:='coalesce(pay.amount, case when not private.hide_broker_terms(l.id) then coalesce(s.broker_rate,l.broker_rate) end, 0)::numeric as gross_rate';
  loaded text:='coalesce(pay.loaded_miles, s.loaded_miles, l.loaded_miles, 0)::numeric as loaded_miles';
  deadhead text:='coalesce(pay.deadhead_miles, o.estimated_deadhead_miles, 0)::numeric as deadhead_miles';
  join_pay text:='left join public.assignment_driver_pay pay on pay.assignment_id = a.id';
begin
  if strpos(definition,gross)=0 or strpos(definition,loaded)=0 or strpos(definition,deadhead)=0
    or strpos(definition,join_pay)=0 or strpos(definition,'''grossRevenue'', totals.gross_revenue,')=0
    or strpos(definition,'''grossRevenue'', gross_rate,')=0
    or strpos(definition,'date_trunc(''day'', ended_at) as day,')=0
    or strpos(definition,'''date'', day,')=0 then
    raise exception 'Unexpected pending-pay analytics projection';
  end if;
  definition:=replace(definition,join_pay,join_pay||E'\n    left join public.assignment_driver_pay_pending pending on pending.assignment_id=a.id');
  definition:=replace(definition,gross,
    'case when pay.assignment_id is null and pending.assignment_id is not null then null else '||replace(gross,' as gross_rate','')||' end as gross_rate');
  definition:=replace(definition,loaded,
    'case when pay.assignment_id is null and pending.assignment_id is not null then null else '||replace(loaded,' as loaded_miles','')||' end as loaded_miles');
  definition:=replace(definition,deadhead,
    'case when pay.assignment_id is null and pending.assignment_id is not null then null else '||replace(deadhead,' as deadhead_miles','')||' end as deadhead_miles,'||E'\n      (pay.assignment_id is null and pending.assignment_id is not null) as pay_pending');
  definition:=replace(definition,'''grossRevenue'', totals.gross_revenue,',$patch$'grossRevenue', totals.gross_revenue,
    'pendingPayCount', (select count(*)::integer from current_completed where pay_pending),
    'hasPendingPay', exists(select 1 from current_completed where pay_pending),
    'activePendingPayCount', (select count(*)::integer from driver_rows where status='active' and pay_pending),$patch$);
  definition:=replace(definition,'''grossRevenue'', gross_rate,',$patch$'grossRevenue', gross_rate,
        'driverPayStatus',case when pay_pending then 'pending' else 'ready' end,$patch$);
  definition:=replace(definition,'date_trunc(''day'', ended_at) as day,',
    'date_trunc(''day'', ended_at) as day, count(*) filter (where pay_pending)::integer as pending_pay_count,');
  definition:=replace(definition,'''date'', day,',
    '''date'', day, ''pendingPayCount'', pending_pay_count, ''hasPendingPay'', pending_pay_count>0,');
  execute definition;
end $migration$;

-- Reuse credential-safe synchronous HTTP transport. Preserve every deployed
-- worker case (including native_calls); activation is a separate release step.
do $migration$
declare definition text:=pg_get_functiondef('worker_cron.invoke(text)'::regprocedure);
  constraint_sql text;
begin
  if strpos(definition,E'    when \'media\' then')=0
    or strpos(definition,E'begin\n  case worker_name')=0 then raise exception 'Unexpected worker invocation'; end if;
  select pg_get_constraintdef(oid) into constraint_sql from pg_constraint
    where conrelid='worker_cron.last_invocations'::regclass and conname='last_invocations_worker_check';
  if constraint_sql is null or left(constraint_sql,6)<>'CHECK ' then raise exception 'Unexpected worker allowlist'; end if;
  alter table worker_cron.last_invocations drop constraint last_invocations_worker_check;
  execute 'alter table worker_cron.last_invocations add constraint last_invocations_worker_check check ('
    ||substring(constraint_sql from 7)||' or worker=''driver_pay'')';
  definition:=replace(definition,E'begin\n  case worker_name',E'begin\n  if worker_name=\'driver_pay\' and not exists(\n    select 1 from public.jobs where type=\'driver.pay_calculation\'\n      and ((status in (\'pending\',\'failed\') and available_at<=now())\n        or (status=\'processing\' and locked_at<now()-interval \'2 minutes\'))\n  ) then return 0; end if;\n  case worker_name');
  execute replace(definition,E'    when \'media\' then',
    E'    when \'driver_pay\' then\n      secret_name := \'driver_pay_cron_token\';\n      endpoint := \'calculate-driver-start-pay\';\n    when \'media\' then');
end $migration$;
-- Deliberately no cron.schedule and no secret provisioning in this migration.
notify pgrst, 'reload schema';
