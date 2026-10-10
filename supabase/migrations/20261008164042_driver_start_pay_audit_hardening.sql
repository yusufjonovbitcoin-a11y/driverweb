-- Additive START-pay audit fixes. No historical pay, origin, route or amount
-- backfill. In-progress paid-driver handoff needs an explicit allocation flow.
create or replace function private.freeze_driver_pay() returns trigger
language plpgsql security definer set search_path='' as $$
declare rate numeric; previous public.assignments; previous_paid boolean; route jsonb;
begin
  perform 1 from public.profiles where id=new.driver_id for update;
  select rate_per_mile into rate from public.driver_pay_settings where driver_id=new.driver_id;
  select a.* into previous from public.loads l join public.assignments a on a.id=l.current_assignment_id
    where l.id=new.load_id and a.id<>new.id;
  previous_paid:=exists(select 1 from public.assignment_driver_pay where assignment_id=previous.id)
    or exists(select 1 from public.assignment_driver_pay_pending where assignment_id=previous.id);
  if (new.driver_stage is distinct from 'accepted' and (rate is not null or previous_paid))
    or ((rate is not null or previous_paid) and previous.id is not null and previous.driver_stage is distinct from 'accepted') then
    raise exception 'DRIVER_PAY_HANDOFF_REQUIRES_REVIEW';
  end if;
  delete from private.driver_pay_quotes where load_id=new.load_id and driver_id=new.driver_id;
  if rate is null then return new; end if;
  select jsonb_agg(to_jsonb(s) order by s.sequence,s.id) into route from public.load_stops s where s.load_id=new.load_id;
  if not private.driver_pay_route_is_routable(route) then raise exception 'DRIVER_PAY_START_ADDRESS_REQUIRED'; end if;
  insert into public.assignment_driver_pay_pending(assignment_id,load_id,driver_id,company_id,rate_per_mile,route_fingerprint)
  values(new.id,new.load_id,new.driver_id,new.company_id,rate,private.pay_route_fingerprint(new.load_id));
  return new;
end $$;
revoke all on function private.freeze_driver_pay() from public,anon,authenticated;

create function private.assert_driver_pay_start_origin(p_assignment_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.assignment_driver_pay_pending p where p.assignment_id=p_assignment_id
    and not exists(select 1 from private.driver_pay_start_origins o where o.assignment_id=p.assignment_id
      and o.load_id=p.load_id and o.driver_id=p.driver_id and o.company_id=p.company_id)) then
    raise exception 'DRIVER_PAY_APP_UPDATE_REQUIRED';
  end if;
end $$;
revoke all on function private.assert_driver_pay_start_origin(uuid) from public,anon,authenticated,service_role;

-- Enforce the invariant at all operational writes, not merely one client RPC.
create or replace function private.require_driver_pay_start_origin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('active','completed') and
    ((new.driver_stage is distinct from old.driver_stage and new.driver_stage<>'accepted')
      or (new.status='completed' and old.status is distinct from new.status)) then
    perform private.assert_driver_pay_start_origin(new.id);
  end if;
  return new;
end $$;
drop trigger require_driver_pay_start_origin on public.assignments;
create trigger require_driver_pay_start_origin before update of driver_stage,status on public.assignments
for each row execute function private.require_driver_pay_start_origin();

create function private.require_stop_driver_pay_start() returns trigger
language plpgsql security definer set search_path='' as $$
declare assignment_id uuid;
begin
  if (tg_op='INSERT' and new.status<>'pending') or
    (tg_op='UPDATE' and new.status is distinct from old.status and new.status<>'pending') then
    select l.current_assignment_id into assignment_id from public.loads l where l.id=new.load_id for update;
    perform private.assert_driver_pay_start_origin(assignment_id);
  end if;
  return new;
end $$;
revoke all on function private.require_stop_driver_pay_start() from public,anon,authenticated,service_role;
create trigger require_stop_driver_pay_start before insert or update of status on public.load_stops
for each row execute function private.require_stop_driver_pay_start();

create function private.require_load_driver_pay_start() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and new.status in ('in_progress','delivered','completed') then
    perform private.assert_driver_pay_start_origin(new.current_assignment_id);
  end if;
  return new;
end $$;
revoke all on function private.require_load_driver_pay_start() from public,anon,authenticated,service_role;
create trigger require_load_driver_pay_start before update of status on public.loads
for each row execute function private.require_load_driver_pay_start();

-- Match the geocoder's street-number contract. Coordinates alone do not attest
-- a stop address. This is syntactic eligibility, not a promised provider match.
create function private.driver_pay_route_is_routable(p_stops jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case when p_stops is null or jsonb_typeof(p_stops)<>'array' then false else
    jsonb_array_length(p_stops) between 2 and 25
    and p_stops->0->>'type'='pickup' and p_stops->-1->>'type'='delivery'
    and not exists(select 1 from jsonb_array_elements(p_stops) s where
      coalesce(s->>'type','') not in ('pickup','delivery')
      or coalesce(s->>'address_line','') !~ '^[0-9]+[A-Za-z]?[[:space:]]+[^[:space:]]'
      or coalesce(s->>'city','') !~ '[^[:space:]]' or coalesce(s->>'region','') !~ '[^[:space:]]')
  end;
$$;
revoke all on function private.driver_pay_route_is_routable(jsonb) from public,anon,authenticated,service_role;
do $migration$
declare definition text:=pg_get_functiondef('public.start_driver_load_with_pay(uuid,uuid,bigint,timestamptz,numeric,numeric,numeric)'::regprocedure);
  anchor text:='  fingerprint:=private.pay_route_fingerprint(l.id);';
begin
  if strpos(definition,anchor)=0 then raise exception 'Unexpected START route validation anchor'; end if;
  execute replace(definition,anchor,$patch$
  if not private.driver_pay_route_is_routable(route) then raise exception 'DRIVER_PAY_START_ROUTE_INVALID'; end if;
$patch$||anchor);
end $migration$;

-- Internal stable projection reads one database snapshot, without exposing
-- origins, provider text, jobs payloads or broker rates.
create function private.assignment_driver_pay_state(p_assignment_id uuid,p_staff boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.assignments; l public.loads; pay public.assignment_driver_pay;
  pending public.assignment_driver_pay_pending; origin private.driver_pay_start_origins; job public.jobs;
  state text; error_code text; retry boolean:=false;
begin
  select * into a from public.assignments where id=p_assignment_id;
  select * into pay from public.assignment_driver_pay where assignment_id=a.id;
  if pay.assignment_id is not null then
    return jsonb_build_object('status','ready','ratePerMile',pay.rate_per_mile,'loadedMiles',pay.loaded_miles,
      'deadheadMiles',pay.deadhead_miles,'totalMiles',pay.total_miles,'amount',pay.amount,'currency',pay.currency,
      'errorCode',null,'attempts',0,'canRetry',false);
  end if;
  select * into pending from public.assignment_driver_pay_pending where assignment_id=a.id;
  if pending.assignment_id is null then return null; end if;
  select * into l from public.loads where id=a.load_id;
  select * into origin from private.driver_pay_start_origins where assignment_id=a.id;
  select * into job from public.jobs where idempotency_key='driver.pay_calculation:'||a.id
    and type='driver.pay_calculation' and company_id=a.company_id and payload->>'assignmentId'=a.id::text;
  if l.current_assignment_id is distinct from a.id or l.trashed_at is not null or a.status not in ('active','completed') then
    state:='failed'; error_code:='DRIVER_PAY_ASSIGNMENT_INACTIVE';
  elsif origin.assignment_id is null then
    if a.driver_stage='accepted' and a.status='active' then state:='awaiting_start';
    else state:='failed'; error_code:='DRIVER_PAY_RECOVERY_REQUIRED'; end if;
  elsif origin.load_id<>a.load_id or origin.driver_id<>a.driver_id or origin.company_id<>a.company_id then
    state:='failed'; error_code:='DRIVER_PAY_RECOVERY_REQUIRED';
  elsif origin.route_fingerprint<>private.pay_route_fingerprint(a.load_id) then
    state:='failed'; error_code:='DRIVER_PAY_ROUTE_INVALID';
  elsif not private.driver_pay_route_is_routable(origin.stops) then
    state:='failed'; error_code:='DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE';
  elsif job.id is null or job.status='completed' then
    state:='failed'; error_code:='DRIVER_PAY_RECOVERY_REQUIRED';
  elsif job.status in ('failed','dead_letter') then
    state:=case when job.status='dead_letter' then 'failed' else 'retry_wait' end;
    error_code:=case job.last_error
      when 'Route provider unavailable' then 'DRIVER_PAY_PROVIDER_UNAVAILABLE'
      when 'DRIVER_PAY_PROVIDER_UNAVAILABLE' then 'DRIVER_PAY_PROVIDER_UNAVAILABLE'
      when 'DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE' then 'DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE'
      when 'DRIVER_PAY_ROUTE_INVALID' then 'DRIVER_PAY_ROUTE_INVALID'
      when 'DRIVER_PAY_WORKER_TIMEOUT' then 'DRIVER_PAY_WORKER_TIMEOUT'
      else 'DRIVER_PAY_CALCULATION_FAILED' end;
    retry:=p_staff and error_code in ('DRIVER_PAY_PROVIDER_UNAVAILABLE','DRIVER_PAY_WORKER_TIMEOUT')
      and job.available_at<=now() and (job.locked_at is null or job.locked_at<now()-interval '2 minutes');
  elsif job.status='processing' and job.locked_at<now()-interval '2 minutes' and job.attempt_count>=job.max_attempts then
    state:='failed'; error_code:='DRIVER_PAY_WORKER_TIMEOUT';
  else state:='calculating';
  end if;
  return jsonb_build_object('status',state,'ratePerMile',pending.rate_per_mile,
    'loadedMiles',null,'deadheadMiles',null,'totalMiles',null,'amount',null,'currency',pending.currency,
    'errorCode',error_code,'attempts',coalesce(job.attempt_count,0),'canRetry',retry);
end $$;
revoke all on function private.assignment_driver_pay_state(uuid,boolean) from public,anon,authenticated,service_role;

create function public.get_assignment_driver_pay(p_assignment_id uuid,p_load_id uuid,p_driver_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles; a public.assignments; staff boolean;
begin
  -- current_profile() takes a key-share lock; projections must also work in
  -- explicitly READ ONLY transactions and observe one consistent snapshot.
  select * into actor from public.profiles where id=(select auth.uid()) and status='active';
  select * into a from public.assignments where id=p_assignment_id and load_id=p_load_id and driver_id=p_driver_id;
  staff:=actor.role in ('company_admin','dispatcher');
  if actor.id is null or actor.status<>'active' or a.id is null or a.company_id<>actor.company_id
    or not ((actor.role='driver' and a.driver_id=actor.id) or (staff and public.can_access_driver(a.driver_id))) then
    raise exception 'DRIVER_PAY_PERMISSION_DENIED';
  end if;
  return private.assignment_driver_pay_state(a.id,staff);
end $$;
revoke all on function public.get_assignment_driver_pay(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_assignment_driver_pay(uuid,uuid,uuid) to authenticated;

create table private.driver_pay_retry_requests (
  operation_id uuid primary key, assignment_id uuid not null references public.assignments(id) on delete cascade,
  load_id uuid not null, driver_id uuid not null, company_id uuid not null, actor_id uuid not null,
  created_at timestamptz not null default now()
);
alter table private.driver_pay_retry_requests enable row level security;
revoke all on private.driver_pay_retry_requests from public,anon,authenticated,service_role;
create function public.retry_assignment_driver_pay(p_assignment_id uuid,p_load_id uuid,p_driver_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); a public.assignments; l public.loads;
  request private.driver_pay_retry_requests; job public.jobs; state jsonb;
begin
  if actor.id is null or actor.status<>'active' or actor.role not in ('company_admin','dispatcher')
    or not public.can_access_driver(p_driver_id) then raise exception 'DRIVER_PAY_RETRY_PERMISSION_DENIED'; end if;
  select * into l from public.loads where id=p_load_id and company_id=actor.company_id for update;
  select * into a from public.assignments where id=p_assignment_id and load_id=l.id
    and driver_id=p_driver_id and company_id=actor.company_id for update;
  if a.id is null then raise exception 'DRIVER_PAY_RETRY_PERMISSION_DENIED'; end if;
  if p_operation_id is null then raise exception 'DRIVER_PAY_RETRY_OPERATION_CONFLICT'; end if;
  -- Serialize even UUID collisions across different assignments.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,271828));
  select * into request from private.driver_pay_retry_requests where operation_id=p_operation_id;
  if request.operation_id is not null then
    if request.assignment_id<>a.id or request.load_id<>a.load_id or request.driver_id<>a.driver_id
      or request.company_id<>a.company_id or request.actor_id<>actor.id then
      raise exception 'DRIVER_PAY_RETRY_OPERATION_CONFLICT'; end if;
    return private.assignment_driver_pay_state(a.id,true);
  end if;
  select * into job from public.jobs where idempotency_key='driver.pay_calculation:'||a.id
    and type='driver.pay_calculation' and company_id=a.company_id and payload->>'assignmentId'=a.id::text for update;
  state:=private.assignment_driver_pay_state(a.id,true);
  if state->>'errorCode' in ('DRIVER_PAY_PROVIDER_UNAVAILABLE','DRIVER_PAY_WORKER_TIMEOUT') and job.status in ('failed','dead_letter')
    and job.available_at>now() then raise exception 'DRIVER_PAY_RETRY_COOLDOWN'; end if;
  if not coalesce((state->>'canRetry')::boolean,false) then raise exception 'DRIVER_PAY_RETRY_UNAVAILABLE'; end if;
  insert into private.driver_pay_retry_requests(operation_id,assignment_id,load_id,driver_id,company_id,actor_id)
  values(p_operation_id,a.id,a.load_id,a.driver_id,a.company_id,actor.id);
  update public.jobs set status='pending',attempt_count=0,available_at=now(),locked_at=null,locked_by=null,
    last_error=null,updated_at=now() where id=job.id;
  update public.assignments set load_revision=load_revision+1 where id=a.id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
  values(a.company_id,actor.id,'driver.pay_calculation_retried','assignment',a.id,
    jsonb_build_object('operationId',p_operation_id,'previousAttempts',job.attempt_count));
  return private.assignment_driver_pay_state(a.id,true);
end $$;
revoke all on function public.retry_assignment_driver_pay(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.retry_assignment_driver_pay(uuid,uuid,uuid,uuid) to authenticated;

-- Preserve the already-tested lease/fingerprint/finalization implementation.
-- Explicit seven-argument overload adds only safe failure classification; old
-- six-argument workers remain compatible and classify errors as transient.
do $migration$
declare definition text:=pg_get_functiondef('public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean)'::regprocedure);
begin
  definition:=replace(definition,'public.finish_driver_pay_calculation(', 'private.finish_driver_pay_calculation_base(');
  execute definition;
end $migration$;
revoke all on function private.finish_driver_pay_calculation_base(uuid,text,numeric,numeric,text,boolean) from public,anon,authenticated,service_role;
create function public.finish_driver_pay_calculation(p_job_id uuid,p_worker_id text,p_loaded_miles numeric,
  p_deadhead_miles numeric,p_provider text,p_failed boolean,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean; code text:=coalesce(p_error_code,'DRIVER_PAY_PROVIDER_UNAVAILABLE'); assignment_id uuid;
begin
  if p_failed and code not in ('DRIVER_PAY_PROVIDER_UNAVAILABLE','DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE','DRIVER_PAY_ROUTE_INVALID') then
    raise exception 'DRIVER_PAY_ERROR_CODE_INVALID'; end if;
  if not p_failed and p_error_code is not null then raise exception 'DRIVER_PAY_ERROR_CODE_INVALID'; end if;
  result:=private.finish_driver_pay_calculation_base(p_job_id,p_worker_id,p_loaded_miles,p_deadhead_miles,p_provider,p_failed);
  if result and p_failed then
    update public.jobs set last_error=code,
      status=case when code='DRIVER_PAY_PROVIDER_UNAVAILABLE' then status else 'dead_letter'::public.job_status end
      where id=p_job_id returning (payload->>'assignmentId')::uuid into assignment_id;
    update public.assignments set load_revision=load_revision+1 where id=assignment_id;
  end if;
  return result;
end $$;
revoke all on function public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean,text) to service_role;
create or replace function public.finish_driver_pay_calculation(p_job_id uuid,p_worker_id text,p_loaded_miles numeric,
  p_deadhead_miles numeric,p_provider text,p_failed boolean default false)
returns boolean language sql security definer set search_path='' as $$
  select public.finish_driver_pay_calculation(p_job_id,p_worker_id,p_loaded_miles,p_deadhead_miles,p_provider,p_failed,null);
$$;
revoke all on function public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean) to service_role;

-- A worker may die on its last attempt. Claim-side exhaustion must wake the
-- privacy-aware mobile projection as well; clients cannot subscribe to jobs.
do $migration$
declare definition text:=pg_get_functiondef('public.claim_driver_pay_calculation(text,uuid)'::regprocedure);
  anchor text:=E'locked_at=null,locked_by=null,updated_at=now() where id=job.id;\n      continue;';
begin
  if strpos(definition,anchor)=0 then raise exception 'Unexpected terminal pay claim anchor'; end if;
  definition:=replace(definition,anchor,E'locked_at=null,locked_by=null,updated_at=now() where id=job.id;\n      update public.assignments set load_revision=load_revision+1 where id=a.id;\n      continue;');
  anchor:='update public.jobs set status=''dead_letter'',last_error=''Pay calculation no longer eligible'',';
  if strpos(definition,anchor)=0 then raise exception 'Unexpected exhausted pay claim anchor'; end if;
  execute replace(definition,anchor,$patch$
      update public.jobs set status='dead_letter',last_error=case
        when job.status='processing' and job.attempt_count>=job.max_attempts
          and job.locked_at<now()-interval '2 minutes' then 'DRIVER_PAY_WORKER_TIMEOUT'
        else 'Pay calculation no longer eligible' end,$patch$);
end $migration$;

-- Keep financial/privacy compatibility while exposing truthful calculation state.
do $migration$
declare definition text:=pg_get_functiondef('public.get_driver_load_rows(uuid[])'::regprocedure);
  anchor text:='''driver_rate_per_mile'',coalesce(pay.rate_per_mile,pending.rate_per_mile),';
begin
  if strpos(definition,anchor)=0 or strpos(definition,'pending public.assignment_driver_pay_pending;')=0
    or strpos(definition,'hidden:=private.hide_broker_terms(l.id);')=0 then raise exception 'Unexpected pay state projection'; end if;
  definition:=replace(definition,'pending public.assignment_driver_pay_pending;', 'pending public.assignment_driver_pay_pending; calculation jsonb;');
  definition:=replace(definition,'hidden:=private.hide_broker_terms(l.id);',
    'calculation:=private.assignment_driver_pay_state(coalesce(pay.assignment_id,pending.assignment_id),false); hidden:=private.hide_broker_terms(l.id);');
  definition:=replace(definition,anchor,anchor||E'\n'||$patch$
      'driver_pay_calculation_status',calculation->>'status',
      'driver_pay_error_code',calculation->>'errorCode',$patch$);
  execute definition;
end $migration$;
