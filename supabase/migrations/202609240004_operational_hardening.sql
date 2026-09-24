-- Final operational rules: dispatcher scopes, online-only offers, term
-- reconfirmation, AI extraction persistence, and worker recovery.

create type public.driver_visibility_scope as enum ('all', 'selected');

create table public.dispatcher_preferences (
  dispatcher_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_scope public.driver_visibility_scope not null default 'all',
  updated_at timestamptz not null default now(),
  constraint dispatcher_preferences_dispatcher_company_fk
    foreign key (dispatcher_id, company_id) references public.profiles(id, company_id)
);

alter table public.dispatcher_preferences enable row level security;

create policy dispatcher_preferences_read on public.dispatcher_preferences
for select to authenticated
using (
  dispatcher_id = (select auth.uid())
  or public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() = 'company_admin')
);

grant select on public.dispatcher_preferences to authenticated;

create or replace function public.can_access_driver(target_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_app_role() = 'super_admin' then true
    when public.current_app_role() = 'company_admin' then exists (
      select 1 from public.profiles p
      where p.id = target_driver_id and p.company_id = public.current_company_id() and p.role = 'driver'
    )
    when public.current_app_role() = 'dispatcher' then exists (
      select 1
      from public.profiles p
      left join public.dispatcher_preferences pref
        on pref.dispatcher_id = (select auth.uid())
      where p.id = target_driver_id
        and p.company_id = public.current_company_id()
        and p.role = 'driver'
        and (
          coalesce(pref.driver_scope, 'all'::public.driver_visibility_scope) = 'all'
          or exists (
            select 1 from public.dispatcher_driver_access a
            where a.dispatcher_id = (select auth.uid()) and a.driver_id = target_driver_id
          )
        )
    )
    else target_driver_id = (select auth.uid())
  end;
$$;

-- NULL means all drivers. A non-NULL array means only those drivers; an empty
-- array intentionally means no drivers.
create or replace function public.set_dispatcher_driver_access(dispatcher_id uuid, driver_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_dispatcher public.profiles;
  target_company_id uuid;
  normalized_driver_ids uuid[] := coalesce(driver_ids, '{}'::uuid[]);
  inserted_count integer := 0;
begin
  if actor.id is null or actor.role not in ('company_admin', 'super_admin') then
    raise exception 'Company admin permission required';
  end if;

  select * into target_dispatcher
  from public.profiles p
  where p.id = dispatcher_id
    and p.role = 'dispatcher'
    and p.status = 'active'
    and (actor.role = 'super_admin' or p.company_id = actor.company_id);
  if target_dispatcher.id is null then raise exception 'Dispatcher not found'; end if;
  target_company_id := target_dispatcher.company_id;

  if driver_ids is not null and exists (
    select 1 from unnest(normalized_driver_ids) d(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = d.id
        and p.company_id = target_company_id
        and p.role = 'driver'
        and p.status = 'active'
    )
  ) then raise exception 'One or more drivers are not eligible'; end if;

  delete from public.dispatcher_driver_access a
  where a.dispatcher_id = set_dispatcher_driver_access.dispatcher_id;

  if driver_ids is not null then
    insert into public.dispatcher_driver_access(dispatcher_id, driver_id, company_id)
    select set_dispatcher_driver_access.dispatcher_id, d.id, target_company_id
    from (select distinct unnest(normalized_driver_ids) as id) d;
    get diagnostics inserted_count = row_count;
  end if;

  insert into public.dispatcher_preferences(dispatcher_id, company_id, driver_scope)
  values (
    set_dispatcher_driver_access.dispatcher_id,
    target_company_id,
    case
      when driver_ids is null then 'all'::public.driver_visibility_scope
      else 'selected'::public.driver_visibility_scope
    end
  )
  on conflict on constraint dispatcher_preferences_pkey do update set
    driver_scope = excluded.driver_scope,
    updated_at = now();

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    target_company_id,
    actor.id,
    'dispatcher.access_updated',
    'profile',
    dispatcher_id,
    jsonb_build_object(
      'scope', case when driver_ids is null then 'all' else 'selected' end,
      'driverIds', to_jsonb(normalized_driver_ids)
    )
  );
  return inserted_count;
end;
$$;

create or replace function public.send_offer(
  load_id uuid,
  driver_id uuid,
  origin_latitude numeric default null,
  origin_longitude numeric default null,
  estimated_deadhead_miles numeric default 0,
  compatibility_warnings jsonb default '[]'::jsonb
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  result public.offers;
  driver_is_online boolean;
  next_offer_status public.offer_status;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  select * into target_load from public.loads
  where id = load_id and company_id = actor.company_id for update;
  if target_load.id is null or target_load.status not in ('ready_for_offer', 'offered') then
    raise exception 'Load is not available for offers';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = driver_id and company_id = actor.company_id and role = 'driver' and status = 'active'
  ) or not public.can_access_driver(driver_id) then
    raise exception 'Driver is not eligible';
  end if;

  select coalesce(p.is_online and p.last_seen_at >= now() - interval '2 minutes', false)
  into driver_is_online
  from public.driver_presence p
  where p.driver_id = send_offer.driver_id and p.company_id = actor.company_id;
  driver_is_online := coalesce(driver_is_online, false);
  next_offer_status := case
    when driver_is_online then 'pending'::public.offer_status
    else 'missed_offline'::public.offer_status
  end;

  insert into public.offers(
    company_id, load_id, driver_id, status, origin_latitude, origin_longitude,
    estimated_deadhead_miles, loaded_miles, effective_rpm,
    compatibility_warnings, delivered_at, created_by
  ) values (
    actor.company_id, target_load.id, driver_id, next_offer_status,
    origin_latitude, origin_longitude, greatest(estimated_deadhead_miles, 0),
    target_load.loaded_miles,
    case when target_load.loaded_miles + greatest(estimated_deadhead_miles, 0) > 0
      then target_load.broker_rate / (target_load.loaded_miles + greatest(estimated_deadhead_miles, 0)) else 0 end,
    coalesce(compatibility_warnings, '[]'::jsonb),
    case when driver_is_online then now() else null end,
    actor.id
  ) returning * into result;

  if driver_is_online then
    update public.loads set status = 'offered', version = version + 1 where id = target_load.id;
    insert into public.notifications(company_id, recipient_id, type, title, body, entity_type, entity_id)
    values (actor.company_id, driver_id, 'load_offer', 'New load offer', 'A dispatcher sent you a load offer.', 'offer', result.id);
  end if;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id,
    actor.id,
    case when driver_is_online then 'offer.sent' else 'offer.missed_offline' end,
    'offer',
    result.id,
    to_jsonb(result)
  );
  return result;
end;
$$;

create or replace function public.cancel_load(load_id uuid, source text, reason text)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  saved public.loads;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  if source not in ('dispatcher', 'broker') then raise exception 'Cancellation source is invalid'; end if;
  select * into saved from public.loads l
  where l.id = cancel_load.load_id and l.company_id = actor.company_id for update;
  if saved.id is null or saved.status in ('completed', 'cancelled') then
    raise exception 'Load cannot be cancelled';
  end if;
  update public.offers o set status = 'withdrawn', responded_at = now()
  where o.load_id = saved.id and o.status = 'pending';
  update public.assignments a set status = 'cancelled', ended_at = now()
  where a.id = saved.current_assignment_id and a.status = 'active';
  update public.loads l set
    status = 'cancelled',
    current_assignment_id = null,
    cancellation_source = cancel_load.source,
    cancellation_reason = cancel_load.reason,
    version = l.version + 1
  where l.id = saved.id returning * into saved;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.cancelled', 'load', saved.id, to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.mark_offer_seen(offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.offers;
begin
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;
  update public.offers
  set seen_at = coalesce(seen_at, now())
  where id = offer_id and driver_id = actor.id and status = 'pending'
  returning * into result;
  if result.id is null then raise exception 'Pending offer not found'; end if;
  return result;
end;
$$;

-- A missed offline offer remains in the audit trail for dispatch, but it is
-- never delivered to the driver later.
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
        select 1 from public.loads l
        left join public.assignments a on a.id = l.current_assignment_id
        where l.id = target_load_id
          and l.company_id = public.current_company_id()
          and (
            (a.driver_id = (select auth.uid()) and a.status = 'active')
            or exists (
              select 1 from public.offers o
              where o.load_id = l.id
                and o.driver_id = (select auth.uid())
                and o.status <> 'missed_offline'
            )
          )
      )
    else false
  end;
$$;

drop policy if exists offers_scoped_read on public.offers;
create policy offers_scoped_read on public.offers for select to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (company_id = public.current_company_id() and public.current_app_role() in ('company_admin', 'dispatcher'))
  or (driver_id = (select auth.uid()) and status <> 'missed_offline')
);

create or replace view public.driver_offer_inbox
with (security_invoker = true)
as
select
  o.id,
  o.load_id,
  o.driver_id,
  o.status,
  o.estimated_deadhead_miles,
  o.loaded_miles,
  o.effective_rpm,
  o.compatibility_warnings,
  o.delivered_at,
  o.seen_at,
  o.created_at,
  l.load_number,
  l.broker_rate,
  l.cargo_description,
  l.equipment_type,
  l.weight_lbs
from public.offers o
join public.loads l on l.id = o.load_id
where o.driver_id = (select auth.uid())
  and o.status <> 'missed_offline';

create or replace function public.respond_offer(
  offer_id uuid,
  response text,
  operation_id uuid,
  occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_offer public.offers;
  target_load public.loads;
  new_assignment public.assignments;
  latest_snapshot_id uuid;
  response_payload jsonb;
begin
  select result into response_payload from public.client_operations
  where client_operations.operation_id = respond_offer.operation_id and actor_id = (select auth.uid());
  if response_payload is not null then return response_payload; end if;
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;

  select * into target_offer from public.offers
  where id = offer_id and driver_id = actor.id and company_id = actor.company_id for update;
  if target_offer.id is null or target_offer.status <> 'pending' then
    raise exception 'Offer is no longer available';
  end if;
  select * into target_load from public.loads where id = target_offer.load_id for update;

  if lower(response) = 'decline' then
    update public.offers set status = 'declined', responded_at = now() where id = target_offer.id;
    response_payload := jsonb_build_object('offerId', target_offer.id, 'status', 'declined');
    insert into public.client_operations values (
      operation_id, actor.company_id, actor.id, target_load.id, 'respond_offer', target_load.version,
      jsonb_build_object('response', 'decline'), occurred_at, now(), 'accepted', response_payload, null
    );
    insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
    values (actor.company_id, actor.id, 'offer.declined', 'offer', target_offer.id, response_payload);
    return response_payload;
  end if;

  if lower(response) <> 'accept' then raise exception 'Response must be accept or decline'; end if;
  if target_load.status not in ('offered', 'ready_for_offer') or target_load.current_assignment_id is not null then
    update public.offers set status = 'superseded', responded_at = now() where id = target_offer.id;
    raise exception 'Load was assigned to another driver';
  end if;

  select id into latest_snapshot_id
  from public.load_price_snapshots
  where load_price_snapshots.load_id = target_load.id
  order by created_at desc, id desc
  limit 1;

  insert into public.assignments(
    company_id, load_id, driver_id, offer_id, assigned_by, accepted_at,
    accepted_price_snapshot_id, requires_reconfirmation, reconfirmed_at
  ) values (
    actor.company_id, target_load.id, actor.id, target_offer.id, target_offer.created_by, now(),
    latest_snapshot_id, false, now()
  ) returning * into new_assignment;

  update public.offers set status = 'accepted', responded_at = now() where id = target_offer.id;
  update public.offers set status = 'superseded', responded_at = now()
    where load_id = target_load.id and id <> target_offer.id and status = 'pending';
  update public.loads
    set status = 'assigned', current_assignment_id = new_assignment.id, version = version + 1
    where id = target_load.id;

  response_payload := jsonb_build_object(
    'offerId', target_offer.id, 'loadId', target_load.id,
    'assignmentId', new_assignment.id, 'status', 'accepted'
  );
  insert into public.client_operations values (
    operation_id, actor.company_id, actor.id, target_load.id, 'respond_offer', target_load.version,
    jsonb_build_object('response', 'accept'), occurred_at, now(), 'accepted', response_payload, null
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'offer.accepted', 'offer', target_offer.id, response_payload);
  return response_payload;
end;
$$;

drop trigger if exists price_snapshot_reconfirmation on public.load_price_snapshots;
drop function if exists public.mark_assignment_reconfirmation();

create or replace function public.update_load_terms(
  load_id uuid,
  broker_rate numeric,
  loaded_miles numeric,
  pickup_appointment_from timestamptz default null,
  pickup_appointment_to timestamptz default null,
  delivery_appointment_from timestamptz default null,
  delivery_appointment_to timestamptz default null,
  source_attachment_id uuid default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  original public.loads;
  result public.loads;
  active_assignment public.assignments;
  terms_changed boolean;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  if broker_rate < 0 or loaded_miles < 0 then raise exception 'Rate and mileage must be non-negative'; end if;

  select * into original
  from public.loads where id = load_id and company_id = actor.company_id for update;
  if original.id is null or original.status in ('completed', 'cancelled') then raise exception 'Load cannot be edited'; end if;

  terms_changed := original.broker_rate is distinct from broker_rate
    or original.loaded_miles is distinct from loaded_miles
    or exists (
      select 1 from public.load_stops s
      where s.load_id = original.id and (
        (s.type = 'pickup' and (
          (pickup_appointment_from is not null and s.appointment_from is distinct from pickup_appointment_from)
          or (pickup_appointment_to is not null and s.appointment_to is distinct from pickup_appointment_to)
        ))
        or (s.type = 'delivery' and (
          (delivery_appointment_from is not null and s.appointment_from is distinct from delivery_appointment_from)
          or (delivery_appointment_to is not null and s.appointment_to is distinct from delivery_appointment_to)
        ))
      )
    );

  update public.loads set
    broker_rate = update_load_terms.broker_rate,
    loaded_miles = update_load_terms.loaded_miles,
    version = case when terms_changed then version + 1 else version end
  where id = original.id returning * into result;

  if terms_changed then
    update public.load_stops set
      appointment_from = case
        when type = 'pickup' then coalesce(pickup_appointment_from, appointment_from)
        else coalesce(delivery_appointment_from, appointment_from)
      end,
      appointment_to = case
        when type = 'pickup' then coalesce(pickup_appointment_to, appointment_to)
        else coalesce(delivery_appointment_to, appointment_to)
      end,
      version = version + 1
    where load_stops.load_id = result.id;

    insert into public.load_price_snapshots(
      company_id, load_id, broker_rate, loaded_miles, loaded_rpm,
      source_attachment_id, requires_driver_reconfirmation, created_by
    ) values (
      actor.company_id, result.id, broker_rate, loaded_miles,
      case when loaded_miles > 0 then broker_rate / loaded_miles else 0 end,
      source_attachment_id, original.current_assignment_id is not null, actor.id
    );

    if original.current_assignment_id is not null then
      update public.assignments
      set requires_reconfirmation = true, reconfirmed_at = null
      where id = original.current_assignment_id and status = 'active'
      returning * into active_assignment;

      if active_assignment.id is not null then
        insert into public.notifications(company_id, recipient_id, type, title, body, entity_type, entity_id)
        values (
          actor.company_id, active_assignment.driver_id, 'terms_changed', 'Load terms changed',
          'The rate, mileage, or appointment changed. Review the updated load.', 'load', result.id
        );
      end if;
    end if;

    insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (actor.company_id, actor.id, 'load.terms_updated', 'load', result.id, to_jsonb(original), to_jsonb(result));
  end if;
  return result;
end;
$$;

-- Drivers cannot advance or complete a load until material term changes have
-- been explicitly reconfirmed.
create or replace function public.assert_assignment_confirmed(target_load_id uuid, target_driver_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.loads l
    join public.assignments a on a.id = l.current_assignment_id
    where l.id = target_load_id
      and a.driver_id = target_driver_id
      and a.status = 'active'
      and a.requires_reconfirmation
  ) then raise exception 'Updated load terms must be confirmed first'; end if;
end;
$$;

create or replace function public.transition_stop(
  stop_id uuid,
  next_status public.stop_status,
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
  target_stop public.load_stops;
  target_load public.loads;
  allowed boolean := false;
  response_payload jsonb;
begin
  select result into response_payload from public.client_operations
  where client_operations.operation_id = transition_stop.operation_id and actor_id = (select auth.uid());
  if response_payload is not null then return response_payload; end if;

  select * into target_stop from public.load_stops where id = stop_id for update;
  if actor.id is null or target_stop.id is null or target_stop.company_id <> actor.company_id then raise exception 'Stop not found'; end if;
  select * into target_load from public.loads where id = target_stop.load_id for update;
  if target_load.version <> base_load_version then raise exception 'Load changed; refresh before retrying'; end if;
  if actor.role = 'driver' then
    if not exists (
      select 1 from public.assignments
      where id = target_load.current_assignment_id and driver_id = actor.id and status = 'active'
    ) then raise exception 'This load is no longer assigned to you'; end if;
    perform public.assert_assignment_confirmed(target_load.id, actor.id);
  end if;
  if actor.role not in ('driver', 'dispatcher', 'company_admin') then raise exception 'Permission denied'; end if;

  allowed := (target_stop.status = 'pending' and next_status in ('arrived', 'skipped'))
          or (target_stop.status = 'arrived' and next_status = 'done');
  if not allowed then raise exception 'Invalid stop transition'; end if;
  if next_status = 'done' and target_stop.requires_document and not exists (
    select 1 from public.documents d where d.stop_id = target_stop.id and d.current_version_id is not null
  ) then raise exception 'Required document is missing'; end if;

  update public.load_stops set status = next_status, version = version + 1 where id = target_stop.id;
  if target_stop.type = 'pickup' and next_status in ('arrived', 'done') then
    update public.loads set status = 'in_progress', version = version + 1 where id = target_load.id;
  elsif target_stop.type = 'delivery' and next_status = 'done' then
    update public.loads set status = 'delivered', version = version + 1 where id = target_load.id;
  else
    update public.loads set version = version + 1 where id = target_load.id;
  end if;

  if actor.role = 'driver' and latitude is not null and longitude is not null then
    insert into public.location_snapshots(company_id, driver_id, load_id, event_type, latitude, longitude, captured_at)
    values (actor.company_id, actor.id, target_load.id, concat(target_stop.type::text, '.', next_status::text), latitude, longitude, occurred_at);
  end if;
  response_payload := jsonb_build_object('stopId', target_stop.id, 'status', next_status, 'loadId', target_load.id);
  insert into public.client_operations values (
    operation_id, actor.company_id, actor.id, target_load.id, 'transition_stop', base_load_version,
    jsonb_build_object('stopId', stop_id, 'nextStatus', next_status), occurred_at, now(), 'accepted', response_payload, null
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'stop.transitioned', 'stop', target_stop.id, response_payload);
  return response_payload;
end;
$$;

create or replace function public.complete_load(load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.loads;
begin
  if actor.id is null or actor.role not in ('driver', 'dispatcher', 'company_admin') then raise exception 'Permission denied'; end if;
  select * into result from public.loads where id = load_id and company_id = actor.company_id for update;
  if result.id is null or result.status <> 'delivered' then raise exception 'Load is not deliverable'; end if;
  if actor.role = 'driver' then
    if not exists (
      select 1 from public.assignments where id = result.current_assignment_id and driver_id = actor.id and status = 'active'
    ) then raise exception 'This load is no longer assigned to you'; end if;
    perform public.assert_assignment_confirmed(result.id, actor.id);
  end if;
  update public.loads set status = 'completed', version = version + 1 where id = result.id returning * into result;
  update public.assignments set status = 'completed', ended_at = now() where id = result.current_assignment_id;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'load.completed', 'load', result.id, to_jsonb(result));
  return result;
end;
$$;

alter table public.ai_extractions
  add constraint ai_extractions_message_attachment_unique
  unique nulls not distinct (message_id, attachment_id);

create or replace function public.record_ai_extraction(
  message_id uuid,
  attachment_id uuid,
  next_status public.ingestion_status,
  model_name text,
  schema_version integer,
  result jsonb,
  fields jsonb default '[]'::jsonb,
  error_message text default null
)
returns public.ai_extractions
language plpgsql
security definer
set search_path = public
as $$
declare
  target_message public.broker_messages;
  saved public.ai_extractions;
  field jsonb;
begin
  if next_status not in ('extracted', 'needs_review', 'parse_failed') then
    raise exception 'Invalid final extraction status';
  end if;
  select * into target_message from public.broker_messages where id = message_id;
  if target_message.id is null then raise exception 'Broker message not found'; end if;
  if attachment_id is not null and not exists (
    select 1 from public.broker_attachments a
    where a.id = attachment_id and a.message_id = target_message.id and a.company_id = target_message.company_id
  ) then raise exception 'Attachment does not belong to message'; end if;

  insert into public.ai_extractions(
    company_id, message_id, attachment_id, status, model_name,
    schema_version, result, error_message, processed_at
  ) values (
    target_message.company_id, target_message.id, attachment_id, next_status,
    model_name, greatest(schema_version, 1), result, left(error_message, 4000), now()
  )
  on conflict on constraint ai_extractions_message_attachment_unique do update set
    status = excluded.status,
    model_name = excluded.model_name,
    schema_version = excluded.schema_version,
    result = excluded.result,
    error_message = excluded.error_message,
    processed_at = excluded.processed_at
  returning * into saved;

  delete from public.ai_extraction_fields f where f.extraction_id = saved.id;
  for field in select * from jsonb_array_elements(coalesce(fields, '[]'::jsonb)) loop
    insert into public.ai_extraction_fields(
      extraction_id, company_id, field_name, extracted_value, confidence, source_reference
    ) values (
      saved.id,
      saved.company_id,
      field->>'name',
      field->'value',
      nullif(field->>'confidence', '')::numeric,
      field->>'sourceReference'
    );
  end loop;

  update public.broker_messages
  set status = next_status, error_message = record_ai_extraction.error_message
  where id = target_message.id;
  return saved;
end;
$$;

create or replace function public.correct_extraction_field(field_id uuid, corrected_value jsonb)
returns public.ai_extraction_fields
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  saved public.ai_extraction_fields;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  update public.ai_extraction_fields
  set dispatcher_value = corrected_value, corrected_by = actor.id, corrected_at = now()
  where id = field_id and company_id = actor.company_id
  returning * into saved;
  if saved.id is null then raise exception 'Extraction field not found'; end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (actor.company_id, actor.id, 'extraction.field_corrected', 'ai_extraction_field', saved.id, to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.register_company_member_as(
  requested_by uuid,
  user_id uuid,
  company_id uuid,
  role public.app_role,
  full_name text,
  email text,
  phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  requester public.profiles;
  saved public.profiles;
begin
  select * into requester from public.profiles p where p.id = requested_by and p.status = 'active';
  if requester.id is null then raise exception 'Requesting member not found'; end if;
  if requester.role = 'super_admin' then
    if role not in ('company_admin', 'dispatcher', 'driver') then raise exception 'Company role is invalid'; end if;
  elsif requester.role = 'company_admin' and requester.company_id = company_id then
    if role not in ('dispatcher', 'driver') then raise exception 'Company admin may add dispatchers or drivers'; end if;
  elsif requester.role = 'dispatcher' and requester.company_id = company_id then
    if role <> 'driver' then raise exception 'Dispatcher may add drivers only'; end if;
  else
    raise exception 'Member management permission required';
  end if;
  if not exists (select 1 from auth.users u where u.id = user_id) then raise exception 'Auth user not found'; end if;

  insert into public.profiles(id, company_id, role, status, full_name, email, phone)
  values (user_id, company_id, role, 'active', trim(full_name), lower(trim(email)), phone)
  on conflict on constraint profiles_pkey do update set
    company_id = excluded.company_id,
    role = excluded.role,
    status = 'active',
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone
  returning * into saved;

  if role = 'driver' then
    insert into public.driver_profiles(user_id, company_id) values (user_id, company_id)
    on conflict on constraint driver_profiles_pkey do update set company_id = excluded.company_id;
  else
    delete from public.driver_profiles where driver_profiles.user_id = register_company_member_as.user_id;
  end if;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value, metadata)
  values (company_id, requested_by, 'member.registered', 'profile', user_id, to_jsonb(saved), jsonb_build_object('source', 'service_role'));
  return saved;
end;
$$;

create or replace function public.register_super_admin(
  user_id uuid,
  full_name text,
  email text,
  phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare saved public.profiles;
begin
  if not exists (select 1 from auth.users u where u.id = user_id) then raise exception 'Auth user not found'; end if;
  insert into public.profiles(id, company_id, role, status, full_name, email, phone)
  values (user_id, null, 'super_admin', 'active', trim(full_name), lower(trim(email)), phone)
  on conflict on constraint profiles_pkey do update set
    company_id = null,
    role = 'super_admin',
    status = 'active',
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone
  returning * into saved;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, new_value, metadata)
  values (user_id, 'super_admin.registered', 'profile', user_id, to_jsonb(saved), jsonb_build_object('source', 'service_role'));
  return saved;
end;
$$;

create or replace function public.create_company_with_admin(
  requested_by uuid,
  company_name text,
  admin_user_id uuid,
  admin_full_name text,
  admin_email text,
  admin_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare new_company_id uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = requested_by and p.role = 'super_admin' and p.status = 'active'
  ) then raise exception 'Super admin permission required'; end if;
  if not exists (select 1 from auth.users u where u.id = admin_user_id) then raise exception 'Auth user not found'; end if;
  if exists (select 1 from public.profiles p where p.id = admin_user_id) then raise exception 'Admin profile already exists'; end if;
  if nullif(trim(company_name), '') is null then raise exception 'Company name is required'; end if;

  insert into public.companies(name) values (trim(company_name)) returning id into new_company_id;
  insert into public.profiles(id, company_id, role, status, full_name, email, phone)
  values (
    admin_user_id, new_company_id, 'company_admin', 'active',
    trim(admin_full_name), lower(trim(admin_email)), admin_phone
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value, metadata)
  values (
    new_company_id, requested_by, 'company.created', 'company', new_company_id,
    jsonb_build_object('name', trim(company_name), 'adminUserId', admin_user_id),
    jsonb_build_object('source', 'service_role')
  );
  return new_company_id;
end;
$$;

create or replace function public.register_gmail_connection(
  company_id uuid,
  mailbox_email text,
  secret_reference text,
  history_id text default null,
  watch_expires_at timestamptz default null,
  created_by uuid default null
)
returns public.gmail_connections
language plpgsql
security definer
set search_path = public
as $$
declare saved public.gmail_connections;
begin
  insert into public.gmail_connections(
    company_id, mailbox_email, status, secret_reference, provider_history_id,
    watch_expires_at, created_by, last_synced_at
  ) values (
    register_gmail_connection.company_id,
    lower(trim(register_gmail_connection.mailbox_email)),
    'active',
    register_gmail_connection.secret_reference,
    register_gmail_connection.history_id,
    register_gmail_connection.watch_expires_at,
    register_gmail_connection.created_by,
    now()
  )
  on conflict on constraint gmail_connections_company_id_key do update set
    mailbox_email = excluded.mailbox_email,
    status = 'active',
    secret_reference = excluded.secret_reference,
    provider_history_id = excluded.provider_history_id,
    watch_expires_at = excluded.watch_expires_at,
    last_error = null,
    last_synced_at = now()
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.ingest_broker_message(
  company_id uuid,
  gmail_connection_id uuid,
  provider_message_id text,
  provider_thread_id text,
  from_email text,
  subject text,
  received_at timestamptz,
  raw_storage_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare saved_message_id uuid;
begin
  insert into public.broker_messages(
    company_id, gmail_connection_id, provider_message_id, provider_thread_id,
    from_email, subject, received_at, raw_storage_path
  ) values (
    ingest_broker_message.company_id,
    ingest_broker_message.gmail_connection_id,
    ingest_broker_message.provider_message_id,
    ingest_broker_message.provider_thread_id,
    lower(trim(ingest_broker_message.from_email)),
    ingest_broker_message.subject,
    ingest_broker_message.received_at,
    ingest_broker_message.raw_storage_path
  )
  on conflict on constraint broker_messages_company_id_provider_message_id_key do update set
    provider_thread_id = excluded.provider_thread_id
  returning id into saved_message_id;

  insert into public.jobs(company_id, type, payload, idempotency_key)
  values (
    ingest_broker_message.company_id,
    'broker_message.extract',
    jsonb_build_object('messageId', saved_message_id),
    concat('broker-message:', ingest_broker_message.company_id, ':', ingest_broker_message.provider_message_id)
  ) on conflict (idempotency_key) do nothing;
  return saved_message_id;
end;
$$;

create or replace function public.set_gmail_connection_status(
  connection_id uuid,
  next_status public.gmail_connection_status,
  provider_history_id text default null,
  watch_expires_at timestamptz default null,
  error_message text default null
)
returns public.gmail_connections
language plpgsql
security definer
set search_path = public
as $$
declare saved public.gmail_connections;
begin
  update public.gmail_connections set
    status = next_status,
    provider_history_id = coalesce(set_gmail_connection_status.provider_history_id, gmail_connections.provider_history_id),
    watch_expires_at = coalesce(set_gmail_connection_status.watch_expires_at, gmail_connections.watch_expires_at),
    last_error = left(error_message, 4000),
    last_synced_at = case when next_status = 'active' then now() else last_synced_at end
  where id = connection_id
  returning * into saved;
  if saved.id is null then raise exception 'Gmail connection not found'; end if;
  return saved;
end;
$$;

create or replace function public.requeue_stale_jobs(stale_after interval default interval '15 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  update public.jobs set
    status = case when attempt_count >= max_attempts then 'dead_letter'::public.job_status else 'failed'::public.job_status end,
    available_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = coalesce(last_error, 'Worker lease expired')
  where status = 'processing' and locked_at < now() - greatest(stale_after, interval '1 minute');
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Prevent accidental direct access to future public objects. Migrations must
-- explicitly grant each client-facing table, view, sequence, and function.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke all on function public.mark_offer_seen(uuid) from public, anon;
revoke all on function public.assert_assignment_confirmed(uuid, uuid) from public, anon;
revoke all on function public.correct_extraction_field(uuid, jsonb) from public, anon;
grant execute on function public.mark_offer_seen(uuid) to authenticated;
grant execute on function public.assert_assignment_confirmed(uuid, uuid) to authenticated;
grant execute on function public.correct_extraction_field(uuid, jsonb) to authenticated;

-- The unrestricted legacy registration function is no longer exposed even to
-- service_role. Workers must use the actor-aware variant.
revoke all on function public.register_company_member(uuid, uuid, public.app_role, text, text, text) from service_role;
revoke all on function public.bootstrap_company(text, text) from authenticated;
revoke all on function public.record_ai_extraction(uuid, uuid, public.ingestion_status, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.register_company_member_as(uuid, uuid, uuid, public.app_role, text, text, text) from public, anon, authenticated;
revoke all on function public.register_super_admin(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_company_with_admin(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.set_gmail_connection_status(uuid, public.gmail_connection_status, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.requeue_stale_jobs(interval) from public, anon, authenticated;
grant execute on function public.record_ai_extraction(uuid, uuid, public.ingestion_status, text, integer, jsonb, jsonb, text) to service_role;
grant execute on function public.register_company_member_as(uuid, uuid, uuid, public.app_role, text, text, text) to service_role;
grant execute on function public.register_super_admin(uuid, text, text, text) to service_role;
grant execute on function public.create_company_with_admin(uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.set_gmail_connection_status(uuid, public.gmail_connection_status, text, timestamptz, text) to service_role;
grant execute on function public.requeue_stale_jobs(interval) to service_role;

drop function public.register_company_member(uuid, uuid, public.app_role, text, text, text);
drop function public.bootstrap_company(text, text);
