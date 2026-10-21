-- One company-wide commission preference. Existing loads/rates are never mutated.
create table public.company_accounting_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  broker_commission_percent numeric not null check (broker_commission_percent >= 0 and broker_commission_percent <= 100 and broker_commission_percent = round(broker_commission_percent, 2)),
  settlement_defaults jsonb not null default '{}'::jsonb check (jsonb_typeof(settlement_defaults) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
create index company_accounting_settings_updated_by_idx on public.company_accounting_settings(updated_by);
alter table public.company_accounting_settings enable row level security;
revoke all on public.company_accounting_settings from public, anon, authenticated;
grant select on public.company_accounting_settings to authenticated;
create policy company_accounting_settings_staff_read on public.company_accounting_settings
for select to authenticated using (exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.company_id = company_accounting_settings.company_id
  and p.status = 'active' and p.role in ('company_admin', 'dispatcher')
));

create or replace function public.update_company_accounting_settings(p_broker_commission_percent numeric, p_expected_version bigint, p_settlement_defaults jsonb)
returns public.company_accounting_settings
language plpgsql security definer set search_path = ''
as $$
declare
  actor public.profiles := public.current_profile();
  previous public.company_accounting_settings;
  result public.company_accounting_settings;
  rule record;
  amount numeric;
  merged_defaults jsonb;
  company_rules jsonb;
begin
  if actor.id is null or actor.company_id is null or actor.status::text is distinct from 'active' or actor.role::text is distinct from 'company_admin' then
    raise exception 'ACCOUNTING_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_broker_commission_percent is null or p_broker_commission_percent < 0 or p_broker_commission_percent > 100
    or p_broker_commission_percent <> round(p_broker_commission_percent, 2) or p_expected_version is null or p_expected_version < 0 then
    raise exception 'ACCOUNTING_INVALID_SETTINGS' using errcode = '22023';
  end if;
  if p_settlement_defaults is null or jsonb_typeof(p_settlement_defaults) <> 'object' then
    raise exception 'ACCOUNTING_INVALID_SETTINGS' using errcode = '22023';
  end if;
  for rule in select key, value from jsonb_each(p_settlement_defaults) loop
    if rule.key not in ('trailer_weekly','truck_weekly','insurance_weekly','logbook_weekly','fuel_weekly','ifta','check','zelle','dispatch_percent') then
      raise exception 'ACCOUNTING_INVALID_SETTINGS' using errcode = '22023';
    end if;
    if rule.value = 'null'::jsonb then continue; end if;
    if jsonb_typeof(rule.value) <> 'string' or (rule.value #>> '{}') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
      raise exception 'ACCOUNTING_INVALID_SETTINGS' using errcode = '22023';
    end if;
    amount := (rule.value #>> '{}')::numeric;
    if amount > 999999999.99 or (rule.key = 'dispatch_percent' and amount > 100) then
      raise exception 'ACCOUNTING_INVALID_SETTINGS' using errcode = '22023';
    end if;
  end loop;
  -- Company row serializes initial insert as well as later updates.
  perform 1 from public.companies where id = actor.company_id for update;
  select * into previous from public.company_accounting_settings where company_id = actor.company_id for update;
  if coalesce(previous.version, 0) <> p_expected_version then
    raise exception 'ACCOUNTING_VERSION_CONFLICT' using errcode = '40001';
  end if;
  -- Old clients still send flat defaults. Keep the newer envelope and every
  -- driver override; synchronize only its company commission rule.
  merged_defaults := p_settlement_defaults;
  if previous.settlement_defaults ? 'driver_settlement_v1' then
    merged_defaults := merged_defaults || jsonb_build_object('driver_settlement_v1', previous.settlement_defaults->'driver_settlement_v1');
    if jsonb_typeof(merged_defaults#>'{driver_settlement_v1,company,rules}') = 'array' then
      select jsonb_agg(case when item->>'id' = 'company' then
        item || jsonb_build_object('enabled', p_broker_commission_percent > 0,
          'method', 'percentage', 'value', round(p_broker_commission_percent, 2)::text)
        else item end order by ordinal)
      into company_rules
      from jsonb_array_elements(merged_defaults#>'{driver_settlement_v1,company,rules}') with ordinality as rules(item, ordinal);
      merged_defaults := jsonb_set(merged_defaults, '{driver_settlement_v1,company,rules}', company_rules);
    end if;
  end if;
  insert into public.company_accounting_settings(company_id, broker_commission_percent, settlement_defaults, version, updated_by)
  values(actor.company_id, p_broker_commission_percent, merged_defaults, 1, actor.id)
  on conflict(company_id) do update set broker_commission_percent = excluded.broker_commission_percent,
    settlement_defaults = excluded.settlement_defaults,
    version = company_accounting_settings.version + 1, updated_by = actor.id, updated_at = now()
  returning * into result;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values(actor.company_id, actor.id, 'company.accounting_settings_updated', 'company', actor.company_id,
    to_jsonb(previous), to_jsonb(result));
  return result;
end;
$$;
revoke all on function public.update_company_accounting_settings(numeric, bigint, jsonb) from public, anon;
grant execute on function public.update_company_accounting_settings(numeric, bigint, jsonb) to authenticated;
