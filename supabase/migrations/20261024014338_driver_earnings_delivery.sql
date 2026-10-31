-- Immutable earnings PDFs. Delivery records a statement, never a payment.
create table public.driver_earnings (
 id uuid primary key,
 company_id uuid not null references public.companies(id),
 driver_id uuid not null references public.profiles(id),
 sent_by uuid not null references public.profiles(id),
 period_from date not null,
 period_to date not null check(period_to >= period_from and period_to - period_from <= 3660),
 gross_cents bigint not null check(gross_cents between 0 and 9007199254740991),
 net_cents bigint not null check(net_cents between 0 and 9007199254740991),
 load_count integer not null check(load_count between 1 and 10000),
 currency text not null default 'USD' check(currency='USD'),
 file_name text not null check(length(file_name) between 1 and 180 and file_name ~ '\.pdf$'),
 storage_path text not null unique,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint not null check(size_bytes between 1 and 20971520),
 sent_at timestamptz not null default now()
);
create index driver_earnings_recipient on public.driver_earnings(driver_id,sent_at desc,id);
alter table public.driver_earnings enable row level security;
revoke all on public.driver_earnings from public,anon,authenticated;
grant select on public.driver_earnings to authenticated;
create policy earnings_recipient_read on public.driver_earnings for select to authenticated using (
 company_id=(select public.current_company_id()) and (
  (select public.current_app_role())::text in ('company_admin','dispatcher') or driver_id=(select auth.uid())
 )
);

create or replace function private.can_upload_driver_earnings(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles a join public.profiles d on d.company_id=a.company_id
 where a.id=(select auth.uid()) and a.status::text='active' and a.role::text='company_admin'
 and d.role::text='driver' and d.status::text in ('active','suspended')
 and split_part(path,'/',1)=a.company_id::text and split_part(path,'/',2)=d.id::text
 and split_part(path,'/',3)=a.id::text
 and path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.pdf$')
 and not exists(select 1 from public.driver_earnings e where e.storage_path=path);
$$;
create or replace function private.can_read_driver_earnings(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.can_upload_driver_earnings(path) or exists (
 select 1 from public.driver_earnings e join public.profiles a on a.company_id=e.company_id
 where e.storage_path=path and a.id=(select auth.uid()) and a.status::text='active'
 and (a.role::text in ('company_admin','dispatcher') or (a.role::text='driver' and e.driver_id=a.id)));
$$;
revoke all on function private.can_upload_driver_earnings(text),private.can_read_driver_earnings(text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.can_upload_driver_earnings(text),private.can_read_driver_earnings(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('driver-earnings','driver-earnings',false,20971520,array['application/pdf']);
create policy earnings_pdf_insert on storage.objects for insert to authenticated
 with check(bucket_id='driver-earnings' and owner_id=(select auth.uid())::text and private.can_upload_driver_earnings(name));
create policy earnings_pdf_read on storage.objects for select to authenticated
 using(bucket_id='driver-earnings' and private.can_read_driver_earnings(name));

create or replace function public.publish_driver_earnings(
 p_id uuid,p_driver uuid,p_period_from date,p_period_to date,p_gross_cents bigint,p_net_cents bigint,
 p_load_count integer,p_file_name text,p_sha256 text,p_size_bytes bigint
) returns public.driver_earnings language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles:=public.current_profile();
 result public.driver_earnings;
 path text;
begin
 if actor.id is null or actor.company_id is null or actor.status::text is distinct from 'active' or actor.role::text is distinct from 'company_admin'
 then raise exception 'EARNINGS_PERMISSION_DENIED' using errcode='42501';end if;
 if p_id is null or p_driver is null or p_period_from is null or p_period_to is null or p_gross_cents is null or p_net_cents is null or p_load_count is null or p_file_name is null or p_sha256 is null or p_size_bytes is null
 then raise exception 'EARNINGS_INVALID';end if;
 if not exists(select 1 from public.profiles p where p.id=p_driver and p.company_id=actor.company_id and p.role::text='driver' and p.status::text in ('active','suspended'))
 then raise exception 'EARNINGS_PERMISSION_DENIED' using errcode='42501';end if;
 path:=actor.company_id::text||'/'||p_driver::text||'/'||actor.id::text||'/'||p_id::text||'.pdf';
 -- Serialize retries before looking up the immutable delivery ID.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from public.driver_earnings where id=p_id;
 if found then
  if result.company_id<>actor.company_id or result.driver_id<>p_driver or result.sent_by<>actor.id or result.sha256<>p_sha256 or result.size_bytes<>p_size_bytes
   or result.period_from<>p_period_from or result.period_to<>p_period_to or result.gross_cents<>p_gross_cents or result.net_cents<>p_net_cents or result.load_count<>p_load_count or result.file_name<>p_file_name
  then raise exception 'EARNINGS_ID_CONFLICT';end if;
  return result;
 end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='driver-earnings' and o.name=path
  and o.owner_id=actor.id::text and (o.metadata->>'size')::bigint=p_size_bytes and o.metadata->>'mimetype'='application/pdf')
 then raise exception 'EARNINGS_PDF_MISSING';end if;
 insert into public.driver_earnings(id,company_id,driver_id,sent_by,period_from,period_to,gross_cents,net_cents,load_count,file_name,storage_path,sha256,size_bytes)
 values(p_id,actor.company_id,p_driver,actor.id,p_period_from,p_period_to,p_gross_cents,p_net_cents,p_load_count,p_file_name,path,p_sha256,p_size_bytes) returning * into result;
 insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
 values(actor.company_id,actor.id,'driver.earnings_sent','driver_earnings',p_id,to_jsonb(result));
 return result;
end;
$$;
revoke all on function public.publish_driver_earnings(uuid,uuid,date,date,bigint,bigint,integer,text,text,bigint) from public,anon;
grant execute on function public.publish_driver_earnings(uuid,uuid,date,date,bigint,bigint,integer,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
