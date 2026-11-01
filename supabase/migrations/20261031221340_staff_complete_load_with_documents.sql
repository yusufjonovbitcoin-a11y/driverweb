-- Staff may attest delivery from saved stop evidence without impersonating a
-- driver START, creating GPS history, or fabricating a mileage/pay snapshot.
create table private.staff_load_completions (
  operation_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete cascade,
  assignment_id uuid not null unique references public.assignments(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  transaction_id xid8 not null default pg_current_xact_id(),
  base_version bigint not null,
  delivered_at timestamptz not null,
  delivered_local timestamp not null,
  time_zone text not null,
  note text not null default '',
  document_versions uuid[] not null,
  evidence jsonb not null,
  state text not null check (state in ('applying','completed')),
  confirmed_at timestamptz,
  result jsonb
);
alter table private.staff_load_completions enable row level security;
revoke all on private.staff_load_completions from public,anon,authenticated,service_role;
create index staff_load_completions_company_load on private.staff_load_completions(company_id,load_id);
create index staff_load_completions_load on private.staff_load_completions(load_id);
create index staff_load_completions_actor on private.staff_load_completions(actor_id);

create function private.staff_completion_in_progress(p_load_id uuid,p_assignment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.staff_load_completions c
    join public.profiles p on p.id=c.actor_id and p.company_id=c.company_id
    where c.load_id=p_load_id and c.assignment_id=p_assignment_id
      and c.actor_id=(select auth.uid()) and p.status='active'
      and p.role in ('dispatcher','company_admin') and c.state='applying'
      and c.transaction_id=pg_current_xact_id());
$$;
revoke all on function private.staff_completion_in_progress(uuid,uuid) from public,anon,authenticated,service_role;

-- Exceptions exist only during the authorized RPC's transaction and only for
-- terminal changes. Ordinary staff/driver stage updates still require START.
create or replace function private.require_driver_pay_start_origin()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and new.driver_stage='completed'
    and private.staff_completion_in_progress(new.load_id,new.id) then return new; end if;
  if new.status in ('active','completed') and
    ((new.driver_stage is distinct from old.driver_stage and new.driver_stage<>'accepted')
      or (new.status='completed' and old.status is distinct from new.status)) then
    perform private.assert_driver_pay_start_origin(new.id);
  end if;
  return new;
end $$;
create or replace function private.require_load_driver_pay_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and private.staff_completion_in_progress(new.id,new.current_assignment_id) then return new; end if;
  if new.status is distinct from old.status and new.status in ('in_progress','delivered','completed') then
    perform private.assert_driver_pay_start_origin(new.current_assignment_id);
  end if;
  return new;
end $$;
create or replace function private.require_stop_driver_pay_start()
returns trigger language plpgsql security definer set search_path='' as $$
declare assignment_id uuid;
begin
  if (tg_op='INSERT' and new.status<>'pending') or
    (tg_op='UPDATE' and new.status is distinct from old.status and new.status<>'pending') then
    select l.current_assignment_id into assignment_id from public.loads l where l.id=new.load_id for update;
    if tg_op='UPDATE' and new.status='done'
      and private.staff_completion_in_progress(new.load_id,assignment_id) then return new; end if;
    perform private.assert_driver_pay_start_origin(assignment_id);
  end if;
  return new;
end $$;

create function public.complete_staff_load(p_load_id uuid,p_assignment_id uuid,p_expected_version bigint,
  p_operation_id uuid,p_document_versions uuid[],p_delivered_local timestamp,p_time_zone text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); l public.loads; a public.assignments;
  previous private.staff_load_completions; proof jsonb; expected uuid[]; supplied uuid[];
  delivery timestamptz; completion_result jsonb;
begin
  if actor.id is null or actor.company_id is null or actor.status<>'active'
    or actor.role not in ('company_admin','dispatcher') then
    raise exception 'STAFF_COMPLETION_PERMISSION_DENIED' using errcode='42501'; end if;
  if p_operation_id is null or p_assignment_id is null or p_expected_version is null
    or p_document_versions is null or cardinality(p_document_versions)>1000
    or p_note is null or length(p_note)>2000 then raise exception 'STAFF_COMPLETION_INVALID_REQUEST'; end if;
  select * into l from public.loads where id=p_load_id and company_id=actor.company_id for update;
  if l.id is null or l.trashed_at is not null then raise exception 'STAFF_COMPLETION_UNAVAILABLE'; end if;
  select array_agg(distinct v order by v) into supplied from unnest(p_document_versions) v;
  select * into previous from private.staff_load_completions where operation_id=p_operation_id;
  if previous.operation_id is not null then
    if previous.load_id is distinct from l.id or previous.assignment_id is distinct from p_assignment_id
      or previous.actor_id is distinct from actor.id or previous.base_version is distinct from p_expected_version
      or previous.document_versions is distinct from supplied or previous.delivered_local is distinct from p_delivered_local
      or previous.time_zone is distinct from p_time_zone or previous.note is distinct from btrim(p_note)
      or previous.state<>'completed' or l.current_assignment_id is distinct from p_assignment_id then
      raise exception 'STAFF_COMPLETION_CONFLICT'; end if;
    return previous.result;
  end if;
  if l.current_assignment_id is distinct from p_assignment_id or l.version is distinct from p_expected_version
    or l.status not in ('assigned','in_progress','delivered') then raise exception 'STAFF_COMPLETION_CONFLICT'; end if;
  select * into a from public.assignments where id=p_assignment_id and load_id=l.id and company_id=l.company_id for update;
  if a.id is null or a.status<>'active' then raise exception 'STAFF_COMPLETION_CONFLICT'; end if;
  if p_delivered_local is null or not isfinite(p_delivered_local) or p_delivered_local<timestamp '2000-01-01'
    or not exists(select 1 from pg_timezone_names where name=p_time_zone) then
    raise exception 'STAFF_COMPLETION_INVALID_TIME'; end if;
  delivery:=p_delivered_local at time zone p_time_zone;
  if delivery>now()+interval '5 minutes' or (delivery at time zone p_time_zone)<>p_delivered_local then
    raise exception 'STAFF_COMPLETION_INVALID_TIME'; end if;
  -- Repeated wall-clock hours need an unambiguous UTC entry instead.
  if ((delivery-interval '1 hour') at time zone p_time_zone)=p_delivered_local
    or ((delivery+interval '1 hour') at time zone p_time_zone)=p_delivered_local then
    raise exception 'STAFF_COMPLETION_AMBIGUOUS_TIME'; end if;

  perform 1 from public.load_stops where load_id=l.id order by id for update;
  perform 1 from public.documents where load_id=l.id order by id for update;
  perform 1 from public.document_versions v join public.documents d on d.current_version_id=v.id
    where d.load_id=l.id order by v.id for key share of v;
  if not exists(select 1 from public.load_stops where load_id=l.id and type='pickup')
    or not exists(select 1 from public.load_stops where load_id=l.id and type='delivery') then
    raise exception 'STAFF_COMPLETION_DOCUMENTS_REQUIRED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('stopId',s.id,'documentId',d.id,'versionId',v.id,'type',d.document_type)
      order by s.sequence,d.id),'[]'::jsonb),array_agg(distinct v.id order by v.id)
    into proof,expected
    from public.load_stops s join public.documents d on d.stop_id=s.id and d.load_id=l.id and d.company_id=l.company_id
      and d.document_type=case when s.type='pickup' then 'bol' else 'pod' end and d.removed_at is null
    join public.document_versions v on v.id=d.current_version_id and v.document_id=d.id and v.company_id=l.company_id
      and v.superseded_at is null and v.upload_lease_started_at is null
      and (l.execution_reset_at is null or v.uploaded_at>=l.execution_reset_at)
    where s.load_id=l.id and s.company_id=l.company_id and (s.status<>'skipped' or s.requires_document);
  if exists(select 1 from public.load_stops s where s.load_id=l.id
    and (s.status<>'skipped' or s.requires_document)
    and not exists(select 1 from jsonb_array_elements(proof) e where e->>'stopId'=s.id::text)) then
    raise exception 'STAFF_COMPLETION_DOCUMENTS_REQUIRED'; end if;
  if expected is null or supplied is distinct from expected then raise exception 'STAFF_COMPLETION_CONFLICT'; end if;
  insert into private.staff_load_completions(operation_id,company_id,load_id,assignment_id,actor_id,base_version,
    delivered_at,delivered_local,time_zone,note,document_versions,evidence,state)
    values(p_operation_id,l.company_id,l.id,a.id,actor.id,l.version,delivery,p_delivered_local,p_time_zone,btrim(p_note),expected,proof,'applying');
  update public.load_stops set status='done',version=version+1 where load_id=l.id and status<>'done'
    and (status<>'skipped' or requires_document);
  update public.assignments set driver_stage='completed',status='completed',ended_at=now() where id=a.id;
  update public.loads set status='completed',version=version+1 where id=l.id returning * into l;
  completion_result:=jsonb_build_object('loadId',l.id,'assignmentId',a.id,'driverId',a.driver_id,'status','completed',
    'driverStage','completed','version',l.version,'deliveredAt',delivery,'completedAt',now(),'operationId',p_operation_id);
  update private.staff_load_completions set state='completed',confirmed_at=now(),result=completion_result
    where operation_id=p_operation_id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(l.company_id,actor.id,'load.staff_completed','load',l.id,completion_result||jsonb_build_object('evidence',proof,'note',btrim(p_note)));
  return completion_result;
end $$;
revoke all on function public.complete_staff_load(uuid,uuid,bigint,uuid,uuid[],timestamp,text,text) from public,anon,service_role;
grant execute on function public.complete_staff_load(uuid,uuid,bigint,uuid,uuid[],timestamp,text,text) to authenticated;

create function public.get_staff_load_completion(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); result jsonb;
begin
  if actor.id is null or actor.status<>'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'STAFF_COMPLETION_PERMISSION_DENIED' using errcode='42501'; end if;
  select c.result||jsonb_build_object('request',jsonb_build_object('baseVersion',c.base_version,
    'documentVersions',c.document_versions,'deliveredLocal',c.delivered_local,'timeZone',c.time_zone,'note',c.note)) into result
    from private.staff_load_completions c join public.loads l on l.id=c.load_id and l.company_id=c.company_id
    where c.operation_id=p_operation_id and c.company_id=actor.company_id and c.actor_id=actor.id
      and c.state='completed' and l.trashed_at is null and l.current_assignment_id=c.assignment_id;
  return result;
end $$;
revoke all on function public.get_staff_load_completion(uuid) from public,anon,service_role;
grant execute on function public.get_staff_load_completion(uuid) to authenticated;

-- Accounting must use the attested delivery instant, including historical
-- delivery entered later by staff, rather than a planned appointment or START.
create or replace function public.driver_settlement_delivery_dates()
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); result jsonb;
begin
 if actor.id is null or actor.company_id is null or actor.status<>'active'
   or actor.role not in ('company_admin','dispatcher') then raise exception 'ACCOUNTING_PERMISSION_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_object_agg(x.load_id::text,x.delivered_at),'{}'::jsonb) into result from (
   select l.id as load_id,coalesce(c.delivered_at,max(least(o.occurred_at,o.received_at))) as delivered_at
   from public.loads l join public.assignments a on a.id=l.current_assignment_id and a.load_id=l.id and a.company_id=l.company_id
   left join private.staff_load_completions c on c.assignment_id=a.id and c.load_id=l.id and c.company_id=l.company_id and c.state='completed'
   left join public.client_operations o on o.load_id=l.id and o.company_id=l.company_id
     and o.status='accepted' and o.command_type='advance_driver_stage' and o.result->>'stage'='delivered'
     and o.actor_id=a.driver_id and o.received_at>=a.assigned_at and (a.ended_at is null or o.received_at<=a.ended_at)
     and o.occurred_at>=a.assigned_at and o.occurred_at<=o.received_at+interval '5 minutes'
     and o.payload->>'nextStage'='delivered' and o.result->>'assignmentId'=l.current_assignment_id::text
   where l.company_id=actor.company_id and l.trashed_at is null and l.status in ('delivered','completed')
   group by l.id,c.delivered_at having c.delivered_at is not null or max(o.occurred_at) is not null
 ) x;
 return result;
end $$;
revoke all on function public.driver_settlement_delivery_dates() from public,anon;
grant execute on function public.driver_settlement_delivery_dates() to authenticated;
