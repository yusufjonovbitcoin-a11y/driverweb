-- Removing a company member is a suspension, not a destructive profile delete.
-- Historical loads, documents and audit records keep their foreign-key owner,
-- while the Edge Function soft-deletes the matching Auth identity.

-- Every authenticated SECURITY DEFINER command resolves its actor through this
-- helper. Suspended accounts must stop working immediately, including while an
-- already-issued JWT remains valid. The row lock also serializes offboarding
-- with in-flight commands issued by the member being removed.
create or replace function public.current_profile()
returns public.profiles
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor public.profiles;
begin
  select * into actor
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'active'
  for key share;

  return actor;
end;
$$;

-- These read RPCs resolve their actor through the locking helper above. Mark
-- them VOLATILE so PostgreSQL does not optimize away or reject that row lock.
alter function public.get_driver_analytics(timestamptz, timestamptz) volatile;
alter function public.get_chat_messages_page(uuid, timestamptz, uuid, integer) volatile;

-- A dispatcher may race an offboarding request while sending an offer. The
-- foreign key only proves that the profile exists, so enforce the operational
-- invariant as well and take a compatible profile lock before a pending offer
-- is created.
create or replace function public.ensure_pending_offer_driver_is_active()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  should_check boolean := false;
begin
  if new.status = 'pending' then
    if tg_op = 'INSERT' then
      should_check := true;
    elsif old.status is distinct from new.status
       or old.driver_id is distinct from new.driver_id
       or old.company_id is distinct from new.company_id then
      should_check := true;
    end if;
  end if;

  if should_check then
    perform 1
    from public.profiles p
    where p.id = new.driver_id
      and p.company_id = new.company_id
      and p.role = 'driver'
      and p.status = 'active'
    for key share;

    if not found then
      raise exception 'Driver is not eligible';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists offers_require_active_driver on public.offers;
create trigger offers_require_active_driver
before insert or update of company_id, driver_id, status on public.offers
for each row execute function public.ensure_pending_offer_driver_is_active();

create or replace function public.suspend_company_member_for_deletion(
  requested_by uuid,
  target_member_id uuid
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  requester public.profiles;
  target public.profiles;
  affected_load record;
  previous_status public.account_status;
  status_changed boolean := false;
  withdrawn_offer_count integer := 0;
  transferred_load_count integer := 0;
  changed_rows integer := 0;
begin
  select * into requester
  from public.profiles p
  where p.id = requested_by
    and p.status = 'active'
  for key share;

  if requester.id is null or requester.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;

  select * into target
  from public.profiles p
  where p.id = target_member_id
    and p.company_id = requester.company_id
  for update;

  if target.id is null then
    raise exception 'Company member not found';
  end if;
  if target.role not in ('driver', 'dispatcher') then
    raise exception 'Only drivers or dispatchers may be removed';
  end if;
  if target.role = 'driver' and exists (
    select 1
    from public.assignments a
    join public.loads l on l.id = a.load_id
    where a.driver_id = target.id
      and a.status = 'active'
      and l.status not in ('completed', 'cancelled')
  ) then
    raise exception 'Driver has an active load';
  end if;

  previous_status := target.status;
  if target.status <> 'suspended' then
    update public.profiles
    set status = 'suspended', updated_at = now()
    where id = target.id
    returning * into target;
    status_changed := true;
  end if;

  if target.role = 'driver' then
    -- Follow the application's load -> offer lock order. Other pending offers
    -- remain valid; only an otherwise-unassigned load is returned to ready.
    for affected_load in
      select l.id, l.status, l.current_assignment_id
      from public.loads l
      where l.company_id = target.company_id
        and exists (
          select 1 from public.offers o
          where o.load_id = l.id
            and o.driver_id = target.id
            and o.status = 'pending'
        )
      order by l.id
      for update of l
    loop
      update public.offers
      set status = 'withdrawn', responded_at = now()
      where load_id = affected_load.id
        and driver_id = target.id
        and status = 'pending';
      get diagnostics changed_rows = row_count;
      withdrawn_offer_count := withdrawn_offer_count + changed_rows;

      if affected_load.status = 'offered'
         and affected_load.current_assignment_id is null
         and not exists (
           select 1 from public.offers o
           where o.load_id = affected_load.id and o.status = 'pending'
         ) then
        update public.loads
        set status = 'ready_for_offer', version = version + 1
        where id = affected_load.id;
      end if;
    end loop;
  else
    -- Open work must keep an active owner. Transfer it to the administrator
    -- performing the removal; completed/cancelled rows retain historical owner.
    update public.loads
    set owner_dispatcher_id = requester.id,
        version = version + 1
    where company_id = target.company_id
      and owner_dispatcher_id = target.id
      and status not in ('completed', 'cancelled');
    get diagnostics transferred_load_count = row_count;
  end if;

  if status_changed then
    insert into public.audit_events(
      company_id, actor_id, action, entity_type, entity_id,
      old_value, new_value, metadata
    ) values (
      target.company_id, requester.id, 'member.removed', 'profile', target.id,
      jsonb_build_object('status', previous_status, 'role', target.role),
      jsonb_build_object('status', target.status, 'role', target.role),
      jsonb_build_object(
        'auth_deletion', 'pending',
        'source', 'delete-member',
        'withdrawn_offer_count', withdrawn_offer_count,
        'transferred_load_count', transferred_load_count
      )
    );
  end if;

  return target;
end;
$$;

revoke all on function public.suspend_company_member_for_deletion(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.suspend_company_member_for_deletion(uuid, uuid)
to service_role;
