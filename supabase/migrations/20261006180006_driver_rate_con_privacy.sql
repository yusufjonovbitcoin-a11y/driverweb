-- Reversible access setting, independent of immutable per-assignment pay.
alter table public.driver_pay_settings add column hide_rate_con boolean not null default false;

create function public.update_driver_contact_pay_privacy(
  p_driver_id uuid, p_full_name text, p_phone text, p_rate_per_mile numeric,
  p_hide_rate_con boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); old_hidden boolean;
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company admin permission required';
  end if;
  if p_hide_rate_con is null then raise exception 'Privacy setting required'; end if;
  -- The existing RPC validates tenant/driver and locks the profile row. Keeping
  -- both writes in this transaction avoids partially saved contact/pay/privacy.
  perform public.update_driver_contact_and_pay(p_driver_id,p_full_name,p_phone,p_rate_per_mile);
  select hide_rate_con into old_hidden from public.driver_pay_settings where driver_id=p_driver_id;
  update public.driver_pay_settings set hide_rate_con=p_hide_rate_con,
    updated_by=actor.id,updated_at=now() where driver_id=p_driver_id;
  if old_hidden is distinct from p_hide_rate_con then
    insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
    values(actor.company_id,actor.id,'driver.rate_con_privacy_updated','profile',p_driver_id,
      jsonb_build_object('hide_rate_con',old_hidden),jsonb_build_object('hide_rate_con',p_hide_rate_con));
    -- Invalidate both active and historic loads, without changing pay snapshots.
    update public.assignments set load_revision=load_revision+1 where driver_id=p_driver_id;
  end if;
end $$;
revoke all on function public.update_driver_contact_pay_privacy(uuid,text,text,numeric,boolean) from public,anon;
grant execute on function public.update_driver_contact_pay_privacy(uuid,text,text,numeric,boolean) to authenticated;

-- All existing restrictive policies (loads, prices, offers, warnings, documents,
-- versions, media, Storage and chat file references) share this predicate.
create or replace function private.hide_broker_terms(p_load_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(public.current_app_role()='driver' and (
   exists(select 1 from public.driver_pay_settings s
     where s.driver_id=(select auth.uid()) and s.hide_rate_con)
   or exists(select 1 from public.assignment_driver_pay p where p.assignment_id=(
     select a.id from public.assignments a where a.driver_id=(select auth.uid()) and a.load_id=p_load_id
     order by a.assigned_at desc,a.id desc limit 1))
 ),false);
$$;

create or replace function public.get_driver_load_rows(p_load_ids uuid[]) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); l public.loads;
  pay public.assignment_driver_pay; result jsonb; hidden boolean;
begin
 if actor.id is null or actor.status <> 'active' or actor.role <> 'driver' then
   raise exception 'Active driver required'; end if;
 if cardinality(p_load_ids)>200 then raise exception 'At most 200 loads per request'; end if;
 for l in select * from public.loads where id=any(p_load_ids) and company_id=actor.company_id
   and public.can_access_load(id) loop
   select p.* into pay from public.assignment_driver_pay p
    where p.assignment_id=(select a.id from public.assignments a where a.load_id=l.id and a.driver_id=actor.id
      order by a.assigned_at desc,a.id desc limit 1);
   hidden:=private.hide_broker_terms(l.id);
   if not hidden then result:=to_jsonb(l);
   else
    -- Allowlist prevents new commercial columns or raw extraction from leaking.
    select jsonb_object_agg(key,value) into result from jsonb_each(to_jsonb(l))
      where key=any(array['id','company_id','load_number','status','current_assignment_id','version',
       'created_at','updated_at','execution_reset_at','broker_name','broker_contact_name','broker_phone','broker_email',
       'owner_dispatcher_id','cargo_description','equipment_type','freight_mode','weight_lbs',
       'temperature_fahrenheit','pallet_count','case_count','is_hazmat']);
    -- Zero is a legacy-client compatibility placeholder, not a quoted price.
    -- New clients omit the price entirely when broker_terms_hidden and no pay.
    result:=result || jsonb_build_object('broker_rate',coalesce(pay.amount,0),
     'loaded_miles',coalesce(pay.loaded_miles,l.loaded_miles),'loaded_rpm',pay.rate_per_mile,
     'driver_pay',case when pay.assignment_id is not null then to_jsonb(pay) else null end,
     'driver_brief',null,'special_instructions',l.driver_instructions,'load_requirements','[]'::jsonb);
   end if;
   return next result || jsonb_build_object('broker_terms_hidden',hidden);
 end loop;
end $$;

create or replace function private.notify_driver_load_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 update public.assignments set load_revision=load_revision+1 where id=new.current_assignment_id
  and (exists(select 1 from public.assignment_driver_pay where assignment_id=new.current_assignment_id)
   or exists(select 1 from public.driver_pay_settings s
     where s.driver_id=assignments.driver_id and s.hide_rate_con));
 return new;
end $$;

-- Broker-priced offers must not silently disappear for a hidden driver.
create or replace function private.guard_fixed_pay_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.driver_pay_settings where driver_id=new.driver_id
   and (rate_per_mile is not null or hide_rate_con)) then
  raise exception 'Use direct assignment for drivers with private broker terms';
 end if;
 return new;
end $$;

-- Analytics is SECURITY DEFINER; row policies alone cannot redact its sums.
-- Patch only the known expression, preserving deployed accounting/timezone fixes.
do $migration$
declare definition text; original text := 'coalesce(pay.amount, s.broker_rate, l.broker_rate, 0)::numeric as gross_rate';
begin
 definition:=pg_get_functiondef('public.get_driver_analytics(timestamptz,timestamptz)'::regprocedure);
 if strpos(definition,original)=0 then raise exception 'Unexpected driver analytics definition'; end if;
 execute replace(definition,original,
  'coalesce(pay.amount, case when not private.hide_broker_terms(l.id) then coalesce(s.broker_rate,l.broker_rate) end, 0)::numeric as gross_rate');
end $migration$;
