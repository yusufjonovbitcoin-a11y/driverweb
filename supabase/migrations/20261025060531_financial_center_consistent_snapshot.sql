-- One STABLE statement reads trips, rules, saved pay and approved statements
-- from the same MVCC snapshot. No OFFSET pages can drift between requests.
create or replace function public.get_financial_center_snapshot()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare actor public.profiles; result jsonb;
begin
  select * into actor from public.profiles where id=(select auth.uid());
  if actor.id is null or actor.company_id is null or actor.status::text<>'active'
    or actor.role::text not in ('company_admin','dispatcher') then
    raise exception 'ACCOUNTING_PERMISSION' using errcode='42501';
  end if;
  with base as materialized (
    select l.id,l.current_assignment_id,l.load_number,l.status::text as status,l.broker_name,
      case when l.status='completed' then 'completed' when l.status='cancelled' then 'cancelled'
        when l.status in ('assigned','in_progress','delivered','dispute') then 'active' else 'planned' end as trip_group,
      a.driver_id,p.full_name as driver_name,
      case when l.status='completed' then coalesce(a.ended_at,l.updated_at)
        else coalesce(a.assigned_at,l.created_at) end as trip_date,
      pickup.city as pickup_city,pickup.region as pickup_region,
      delivery.city as delivery_city,delivery.region as delivery_region,
      case when s.id is not null then s.broker_rate
        when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'brokerRate' then null
        else l.broker_rate end as contract_amount,
      case when s.id is not null then s.loaded_miles
        when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'loadedMiles' then null
        else l.loaded_miles end as loaded_miles,
      f.additional_income,f.driver_pay,f.fuel_cost,f.toll_cost,f.other_cost,f.broker_paid,
      f.notes,coalesce(f.version,0) as accounting_version,f.updated_at as accounting_updated_at
    from public.loads l
    left join public.assignments a on a.id=l.current_assignment_id and a.company_id=l.company_id
    left join public.profiles p on p.id=a.driver_id and p.company_id=l.company_id
    left join public.load_price_snapshots s on s.id=a.accepted_price_snapshot_id and s.load_id=l.id and s.company_id=l.company_id
    left join public.load_accounting f on f.load_id=l.id and f.company_id=l.company_id
    left join lateral (select city,region from public.load_stops where load_id=l.id and company_id=l.company_id and type='pickup' order by sequence limit 1) pickup on true
    left join lateral (select city,region from public.load_stops where load_id=l.id and company_id=l.company_id and type='delivery' order by sequence desc limit 1) delivery on true
    where l.company_id=actor.company_id and l.trashed_at is null
  )
  select jsonb_build_object(
    'schemaVersion',1,'total',(select count(*) from base),'fetchedAt',statement_timestamp(),
    'rows',coalesce((select jsonb_agg(to_jsonb(b) order by b.trip_date desc,b.id) from base b),'[]'::jsonb),
    'loads',coalesce((select jsonb_agg(jsonb_build_object('id',id,'current_assignment_id',current_assignment_id)) from base),'[]'::jsonb),
    'settings',(select jsonb_build_object('broker_commission_percent',s.broker_commission_percent,
      'settlement_defaults',s.settlement_defaults,'version',s.version,'updated_at',s.updated_at)
      from public.company_accounting_settings s where s.company_id=actor.company_id),
    'pay',coalesce((select jsonb_agg(jsonb_build_object('assignment_id',p.assignment_id,'load_id',p.load_id,
      'driver_id',p.driver_id,'amount',p.amount,'currency',p.currency,'loaded_miles',p.loaded_miles))
      from public.assignment_driver_pay p join base b on b.current_assignment_id=p.assignment_id and b.id=p.load_id
      where p.company_id=actor.company_id),'[]'::jsonb),
    -- Keep existing settlement RLS: dispatchers do not gain access to admin PDFs.
    'settlementsAvailable',actor.role::text='company_admin',
    'settlements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'number',s.number,'driverId',s.driver_id,'approvedAt',s.approved_at,
      'calculation',jsonb_build_object('gross',s.gross_cents,'net',s.net_cents,
        'commission',s.snapshot#>'{calculation,commission}','earnings',s.snapshot#>'{calculation,earnings}',
        'deducted',s.snapshot#>'{calculation,deducted}',
        'deductions',coalesce((select jsonb_agg(jsonb_build_object('id',d->'id','amount',d->'amount'))
          from jsonb_array_elements(s.snapshot#>'{calculation,deductions}') d),'[]'::jsonb),
        'rows',(select jsonb_agg(jsonb_build_object('load',jsonb_build_object('id',r#>'{load,id}'),
          'gross',r->'gross','commission',r->'commission','net',r->'net','miles',r->'miles') order by n)
          from jsonb_array_elements(s.snapshot#>'{calculation,rows}') with ordinality as items(r,n))
      )) order by s.approved_at,s.id) from public.driver_settlements s
      where s.company_id=actor.company_id and exists (select 1 from public.driver_settlement_loads sl
        join base b on b.id=sl.load_id where sl.company_id=actor.company_id and sl.settlement_id=s.id)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_financial_center_snapshot() from public,anon;
grant execute on function public.get_financial_center_snapshot() to authenticated;
comment on function public.get_financial_center_snapshot() is 'Tenant-scoped consistent financial snapshot; respects existing settlement RLS and never changes accounting records.';
