-- A confirmed statement is immutable evidence, never a record of payment.
create table public.driver_settlements (
 id uuid primary key,
 company_id uuid not null references public.companies(id),
 driver_id uuid not null,
 approved_by uuid not null,
 number bigint not null,
 approved_at timestamptz not null default now(),
 period_from date not null,
 period_to date not null check(period_to>=period_from and period_to-period_from<=3660),
 gross_cents bigint not null check(gross_cents between 0 and 9007199254740991),
 net_cents bigint not null check(net_cents between 0 and 9007199254740991),
 load_count integer not null check(load_count between 1 and 500),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=524288),
 summary jsonb not null,
 storage_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 180 and file_name ~ '\.pdf$'),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint not null check(size_bytes between 1 and 20971520),
 unique(id,company_id), unique(company_id,number),
 foreign key(driver_id,company_id) references public.profiles(id,company_id),
 foreign key(approved_by,company_id) references public.profiles(id,company_id)
);
create index driver_settlements_company_date on public.driver_settlements(company_id,approved_at desc,id);
create index driver_settlements_driver on public.driver_settlements(driver_id,company_id,approved_at desc);
create index driver_settlements_approver on public.driver_settlements(approved_by,company_id);
create table public.driver_settlement_loads (
 company_id uuid not null references public.companies(id),
 load_id uuid not null,
 settlement_id uuid not null,
 primary key(company_id,load_id),
 foreign key(load_id,company_id) references public.loads(id,company_id),
 foreign key(settlement_id,company_id) references public.driver_settlements(id,company_id)
);
create index driver_settlement_loads_statement on public.driver_settlement_loads(settlement_id,company_id);
create index driver_settlement_loads_load on public.driver_settlement_loads(load_id,company_id);
alter table public.driver_settlements enable row level security;
alter table public.driver_settlement_loads enable row level security;
revoke all on public.driver_settlements,public.driver_settlement_loads from public,anon,authenticated;
grant select on public.driver_settlements,public.driver_settlement_loads to authenticated;
create policy settlement_admin_read on public.driver_settlements for select to authenticated using (
 company_id=(select public.current_company_id()) and (select public.current_app_role())::text='company_admin'
);
create policy settlement_claim_admin_read on public.driver_settlement_loads for select to authenticated using (
 company_id=(select public.current_company_id()) and (select public.current_app_role())::text='company_admin'
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('driver-settlements','driver-settlements',false,20971520,array['application/pdf']);
create function private.can_upload_settlement_pdf(path text) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles a join public.profiles d on d.company_id=a.company_id
 where a.id=(select auth.uid()) and a.status::text='active' and a.role::text='company_admin'
 and d.role::text='driver' and d.status::text in('active','suspended')
 and split_part(path,'/',1)=a.company_id::text and split_part(path,'/',2)=d.id::text
 and split_part(path,'/',3)=a.id::text and path ~ '/[a-f0-9-]{36}\.pdf$'
 and array_length(string_to_array(path,'/'),1)=4);
$$;
create function private.can_read_settlement_pdf(path text) returns boolean
 language sql stable security definer set search_path='' as $$
 select private.can_upload_settlement_pdf(path) or exists(select 1
 from public.driver_settlements s join public.profiles a on a.company_id=s.company_id
 where s.storage_path=path and a.id=(select auth.uid()) and a.status::text='active' and a.role::text='company_admin');
$$;
revoke all on function private.can_upload_settlement_pdf(text),private.can_read_settlement_pdf(text) from public,anon;
grant execute on function private.can_upload_settlement_pdf(text),private.can_read_settlement_pdf(text) to authenticated;
create policy settlement_pdf_upload on storage.objects for insert to authenticated with check (
 bucket_id='driver-settlements' and private.can_upload_settlement_pdf(name)
);
create policy settlement_pdf_read on storage.objects for select to authenticated using (
 bucket_id='driver-settlements' and private.can_read_settlement_pdf(name)
);
-- Only an uncommitted upload can be removed; approved PDF bytes cannot be replaced.
create policy settlement_pdf_abandoned_delete on storage.objects for delete to authenticated using (
 bucket_id='driver-settlements' and owner_id=(select auth.uid())::text
 and private.can_upload_settlement_pdf(name)
 and not exists(select 1 from public.driver_settlements s where s.storage_path=name)
);

create function public.confirm_driver_settlement(p_id uuid,p_snapshot jsonb,p_file_name text,p_sha256 text,p_size_bytes bigint)
 returns public.driver_settlements language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles; target public.profiles; result public.driver_settlements;
 c jsonb; item jsonb; summary_rows jsonb; ids uuid[]; row_count integer; expected_version bigint;
 gross bigint; net bigint; sum_gross numeric; date_from date; date_to date; file_path text; settings_version bigint;
begin
 actor:=public.current_profile();
 if actor.id is null or actor.status::text<>'active' or actor.role::text<>'company_admin' then
  raise exception 'SETTLEMENT_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_id is null or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>524288
 or p_file_name is null or length(p_file_name) not between 1 and 180 or p_file_name !~ '\.pdf$'
 or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_size_bytes is null or p_size_bytes not between 1 and 20971520
 then raise exception 'SETTLEMENT_INVALID'; end if;
 if coalesce((p_snapshot->>'isDemo')::boolean,false) then raise exception 'SETTLEMENT_INVALID';end if;
 c:=p_snapshot->'calculation';
 if jsonb_typeof(c)<>'object' or jsonb_typeof(c->'rows')<>'array' then raise exception 'SETTLEMENT_INVALID';end if;
 row_count:=jsonb_array_length(c->'rows');
 if row_count not between 1 and 500 or jsonb_typeof(c#>'{settings,rules}') is distinct from 'array'
 or jsonb_typeof(c->'deductions') is distinct from 'array' then raise exception 'SETTLEMENT_INVALID';end if;
 select * into target from public.profiles where id=(p_snapshot#>>'{driver,id}')::uuid
 and company_id=actor.company_id and role::text='driver' and status::text in('active','suspended') for key share;
 if target.id is null then raise exception 'SETTLEMENT_PERMISSION_DENIED' using errcode='42501';end if;
 if coalesce(c->>'gross','')!~ '^\d+$' or coalesce(c->>'net','')!~ '^\d+$' then raise exception 'SETTLEMENT_INVALID';end if;
 gross:=(c->>'gross')::bigint;net:=(c->>'net')::bigint;
 if gross not between 0 and 9007199254740991 or net not between 0 and 9007199254740991 then raise exception 'SETTLEMENT_INVALID';end if;
 date_from:=(c#>>'{period,from}')::date;date_to:=(c#>>'{period,to}')::date;
 if date_from is null or date_to is null or date_to<date_from or date_to-date_from>3660 then raise exception 'SETTLEMENT_INVALID';end if;
 file_path:=actor.company_id::text||'/'||target.id::text||'/'||actor.id::text||'/'||p_id::text||'.pdf';
 -- Same request after a lost response returns the original immutable statement.
 perform pg_advisory_xact_lock(hashtextextended(actor.company_id::text,8127));
 select * into result from public.driver_settlements where id=p_id;
 if result.id is not null then
  if result.company_id<>actor.company_id or result.driver_id<>target.id or result.approved_by<>actor.id
   or result.sha256<>p_sha256 or result.snapshot<>p_snapshot or result.size_bytes<>p_size_bytes or result.file_name<>p_file_name
   then raise exception 'SETTLEMENT_ID_CONFLICT';end if;
  return result;
 end if;
 select array_agg((r#>>'{load,id}')::uuid order by (r#>>'{load,id}')::uuid),sum((r->>'gross')::numeric)
 into ids,sum_gross from jsonb_array_elements(c->'rows') r;
 if cardinality(ids)<>row_count or (select count(distinct i) from unnest(ids) i)<>row_count or sum_gross<>gross then
  raise exception 'SETTLEMENT_INVALID';end if;
 select version into settings_version from public.company_accounting_settings where company_id=actor.company_id for share;
 if settings_version is null or settings_version is distinct from (p_snapshot->>'settingsVersion')::bigint then
  raise exception 'SETTLEMENT_SETTINGS_CHANGED';end if;
 perform 1 from public.loads where id=any(ids) order by id for update;
 if exists(select 1 from public.driver_settlement_loads where company_id=actor.company_id and load_id=any(ids)) then
  raise exception 'SETTLEMENT_ALREADY_CONFIRMED';end if;
 for item in select value from jsonb_array_elements(c->'rows') loop
  expected_version:=nullif(item#>>'{load,version}','')::bigint;
  if expected_version is null or expected_version<1 or coalesce(item->>'gross','')!~ '^\d+$'
   or coalesce(item->>'commission','')!~ '^\d+$' then raise exception 'SETTLEMENT_INVALID';end if;
  if not exists(select 1 from public.loads l join public.assignments a on a.id=l.current_assignment_id and a.company_id=l.company_id
   where l.id=(item#>>'{load,id}')::uuid and l.company_id=actor.company_id and a.driver_id=target.id
   and l.trashed_at is null and l.status::text not in('cancelled','draft','offered')
   and (expected_version is null or l.version=expected_version))
   or (item#>>'{load,driverId}') is distinct from target.id::text then
   raise exception 'SETTLEMENT_LOAD_CHANGED';end if;
 end loop;
 if not exists(select 1 from storage.objects o where o.bucket_id='driver-settlements' and o.name=file_path
  and o.owner_id=actor.id::text and (o.metadata->>'size')::bigint=p_size_bytes and o.metadata->>'mimetype'='application/pdf') then
  raise exception 'SETTLEMENT_PDF_MISSING';end if;
 select jsonb_agg(jsonb_build_object('gross',r->'gross','commission',r->'commission','net',r->'net','miles',r->'miles',
  'load',jsonb_build_object('id',r#>'{load,id}','loadNumber',r#>'{load,loadNumber}',
   'origin',jsonb_build_object('city',r#>'{load,origin,city}','state',r#>'{load,origin,state}'),
   'destination',jsonb_build_object('city',r#>'{load,destination,city}','state',r#>'{load,destination,state}'))))
 into summary_rows from jsonb_array_elements(c->'rows') r;
 insert into public.driver_settlements(id,company_id,driver_id,approved_by,number,period_from,period_to,gross_cents,net_cents,load_count,
  snapshot,summary,storage_path,file_name,sha256,size_bytes)
 values(p_id,actor.company_id,target.id,actor.id,
  coalesce((select max(s.number) from public.driver_settlements s where s.company_id=actor.company_id),0)+1,
  date_from,date_to,gross,net,row_count,p_snapshot,
  jsonb_build_object('driver',jsonb_build_object('id',target.id,'name',target.full_name),
   'settingsVersion',settings_version,'calculation',jsonb_build_object('period',c->'period','gross',gross,'net',net,'rows',summary_rows)),
  file_path,p_file_name,p_sha256,p_size_bytes) returning * into result;
 insert into public.driver_settlement_loads(company_id,load_id,settlement_id) select actor.company_id,i,p_id from unnest(ids) i;
 insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
 values(actor.company_id,actor.id,'driver.settlement_confirmed','driver_settlements',p_id,
  jsonb_build_object('number',result.number,'driverId',target.id,'grossCents',gross,'netCents',net,'loadCount',row_count,'sha256',p_sha256));
 return result;
end;
$$;
revoke all on function public.confirm_driver_settlement(uuid,jsonb,text,text,bigint) from public,anon;
grant execute on function public.confirm_driver_settlement(uuid,jsonb,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
