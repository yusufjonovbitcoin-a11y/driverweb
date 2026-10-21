-- Requires 20261017215323_company_accounting_settings.sql.
-- Same staff-read / company-admin-write boundary; no payment or load mutation.
create or replace function public.save_driver_calculation_settings(p_driver uuid,p_expected_version bigint,p_settings jsonb)
returns public.company_accounting_settings
language plpgsql security definer set search_path = '' as $$
declare
 actor public.profiles := public.current_profile();
 previous public.company_accounting_settings;
 result public.company_accounting_settings;
 envelope jsonb;
 defaults jsonb;
 r jsonb;
 ids text[] := array[]::text[];
 mandatory text[] := array['company','dispatch','truck','trailer','insurance','eld','fuel','ifta','check','zelle'];
 n numeric;
 fee numeric;
begin
 if actor.id is null or actor.company_id is null or actor.status::text is distinct from 'active' or actor.role::text is distinct from 'company_admin' then
  raise exception 'ACCOUNTING_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_expected_version is null or p_expected_version<0 then raise exception 'ACCOUNTING_INVALID_SETTINGS'; end if;
 if p_driver is not null and not exists(select 1 from public.profiles p where p.id=p_driver and p.company_id=actor.company_id and p.role::text='driver' and p.status::text in ('active','suspended')) then raise exception 'ACCOUNTING_PERMISSION_DENIED' using errcode='42501';end if;
 if p_settings is null and p_driver is null then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
 if p_settings is not null then
  if jsonb_typeof(p_settings) is distinct from 'object' or p_settings->'schema' is distinct from '1'::jsonb or p_settings->>'currency' is distinct from 'USD' or coalesce(p_settings->>'partialWeeks','') not in ('prorate','full') or jsonb_typeof(p_settings->'pdf') is distinct from 'object' or jsonb_typeof(p_settings->'rules') is distinct from 'array' then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
  if jsonb_array_length(p_settings->'rules') not between 10 and 30 or jsonb_typeof(p_settings->'pdf'->'loads') is distinct from 'boolean' or jsonb_typeof(p_settings->'pdf'->'deductions') is distinct from 'boolean' or jsonb_typeof(p_settings->'pdf'->'total') is distinct from 'boolean' then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
  for r in select value from jsonb_array_elements(p_settings->'rules') loop
   if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'id') is distinct from 'string' or (not ((r->>'id')=any(mandatory)) and (r->>'id') !~ '^custom_[a-z0-9]{1,40}$') or (r->>'id')=any(ids) then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
   ids:=array_append(ids,r->>'id');
   if jsonb_typeof(r->'enabled') is distinct from 'boolean' or jsonb_typeof(r->'label') is distinct from 'string' or length(r->>'label')>100 or ((r->>'id') like 'custom_%' and btrim(r->>'label')='') or coalesce(r->>'method','') not in ('fixed','percentage') or coalesce(r->>'basis','') not in ('gross','after_company') or coalesce(r->>'frequency','') not in ('per_load','per_settlement','weekly','monthly') then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
   if r->>'id'='company' and (r->>'basis'<>'gross' or r->>'frequency' not in ('per_load','per_settlement')) then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
   if r->>'method'='percentage' and r->>'frequency' not in ('per_load','per_settlement') then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
   if jsonb_typeof(r->'value') is distinct from 'string' or (r->>'value') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
   n:=(r->>'value')::numeric;
   if n>9999999.99 or (r->>'method'='percentage' and n>100) then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
  end loop;
  if not mandatory<@ids then raise exception 'ACCOUNTING_INVALID_SETTINGS';end if;
 end if;
 perform 1 from public.companies where id=actor.company_id for update;
 select * into previous from public.company_accounting_settings where company_id=actor.company_id for update;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'ACCOUNTING_VERSION_CONFLICT' using errcode='40001';end if;
 defaults:=coalesce(previous.settlement_defaults,'{}'::jsonb);
 envelope:=coalesce(defaults->'driver_settlement_v1','{"drivers":{}}'::jsonb);
 if p_driver is null then envelope:=jsonb_set(envelope,'{company}',p_settings,true);
 else
  envelope:=jsonb_set(envelope,'{drivers}',case when p_settings is null then coalesce(envelope->'drivers','{}'::jsonb)-p_driver::text else coalesce(envelope->'drivers','{}'::jsonb)||jsonb_build_object(p_driver::text,p_settings) end,true);
 end if;
 defaults:=jsonb_set(defaults,'{driver_settlement_v1}',envelope,true);
 fee:=coalesce(previous.broker_commission_percent,0);
 if p_driver is null then
  select case when (value->>'enabled')::boolean and value->>'method'='percentage' then (value->>'value')::numeric else 0 end into fee from jsonb_array_elements(p_settings->'rules') where value->>'id'='company';
 end if;
 insert into public.company_accounting_settings(company_id,broker_commission_percent,settlement_defaults,version,updated_by)
 values(actor.company_id,fee,defaults,1,actor.id)
 on conflict(company_id) do update set broker_commission_percent=excluded.broker_commission_percent,settlement_defaults=excluded.settlement_defaults,version=company_accounting_settings.version+1,updated_by=actor.id,updated_at=now()
 returning * into result;
 insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
 values(actor.company_id,actor.id,'company.driver_calculation_settings_updated','company',actor.company_id,to_jsonb(previous),to_jsonb(result));
 return result;
end;
$$;
revoke all on function public.save_driver_calculation_settings(uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_driver_calculation_settings(uuid,bigint,jsonb) to authenticated;

-- Actual delivery event for the current assignment, never a planned appointment.
create or replace function public.driver_settlement_delivery_dates()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); result jsonb;
begin
 if actor.id is null or actor.company_id is null or actor.status::text is distinct from 'active' or coalesce(actor.role::text,'') not in ('company_admin','dispatcher') then raise exception 'ACCOUNTING_PERMISSION_DENIED' using errcode='42501';end if;
 select coalesce(jsonb_object_agg(x.load_id::text,x.delivered_at),'{}'::jsonb) into result from (
  select l.id as load_id,max(least(o.occurred_at,o.received_at)) as delivered_at
  from public.loads l join public.assignments a on a.id=l.current_assignment_id and a.load_id=l.id and a.company_id=l.company_id
  join public.client_operations o on o.load_id=l.id and o.company_id=l.company_id
  where l.company_id=actor.company_id and l.trashed_at is null and l.status::text in ('delivered','completed')
   and o.status::text='accepted' and o.command_type='advance_driver_stage'
   and o.result->>'stage'='delivered' and o.actor_id=a.driver_id
   and o.received_at>=a.assigned_at and (a.ended_at is null or o.received_at<=a.ended_at)
   and o.occurred_at>=a.assigned_at and o.occurred_at<=o.received_at+interval '5 minutes'
   and o.payload->>'nextStage'='delivered' and o.result->>'assignmentId'=l.current_assignment_id::text
   and o.occurred_at is not null
  group by l.id
 ) x;
 return result;
end;
$$;
revoke all on function public.driver_settlement_delivery_dates() from public,anon;
grant execute on function public.driver_settlement_delivery_dates() to authenticated;
