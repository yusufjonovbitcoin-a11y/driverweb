-- Historical review JSON is unstructured and may predate price minimization.
-- Private-price drivers cannot read raw checks, including via direct REST or
-- Realtime. Preserve the existing overview/status contract without rewriting
-- any old result JSON. Both manual privacy and per-assignment mileage pay use
-- the same private.hide_broker_terms predicate.
create policy document_checks_broker_privacy on public.document_checks
as restrictive for select to authenticated using (
  exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id
    where v.id=document_checks.document_version_id and not private.hide_broker_terms(d.load_id))
);

create function private.document_review_checks(target_document_id uuid)
returns table(id uuid,status public.document_check_status,confidence numeric,model_name text,result jsonb,checked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare document public.documents; hidden boolean;
begin
  -- Do not call current_profile(): mutation versions of that helper take locks
  -- and cannot run inside PostgREST's read-only view transaction.
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active') then return; end if;
  select d.* into document from public.documents d join public.loads l on l.id=d.load_id
    where d.id=target_document_id and l.trashed_at is null;
  if document.id is null or not public.can_access_load(document.load_id) then return; end if;
  hidden := private.hide_broker_terms(document.load_id);
  if hidden and document.document_type in ('rate_confirmation','receipt') then return; end if;
  return query select c.id,c.status,c.confidence,
    case when hidden then null::text else c.model_name end,
    case when hidden then null::jsonb else c.result end,c.checked_at
    from public.document_checks c where c.document_version_id=document.current_version_id
      and c.company_id=document.company_id;
end $$;
revoke all on function private.document_review_checks(uuid) from public,anon;
grant execute on function private.document_review_checks(uuid) to authenticated;

create or replace view public.document_review_overview with (security_invoker=true) as
select d.id as document_id,d.load_id,d.document_type,d.current_version_id,
  c.id as check_id,c.status as check_status,c.confidence::numeric(5,4) as check_confidence,
  c.model_name as check_model_name,c.result as check_result,c.checked_at,
  coalesce(jsonb_agg(jsonb_build_object('id',w.id,'code',w.code,'params',w.params) order by w.created_at)
    filter(where w.id is not null and w.is_active),'[]'::jsonb) as active_warnings
from public.documents d
left join lateral private.document_review_checks(d.id) c on true
left join public.warnings w on w.document_check_id=c.id
group by d.id,d.load_id,d.document_type,d.current_version_id,c.id,c.status,c.confidence,c.model_name,c.result,c.checked_at;
revoke all on public.document_review_overview from public,anon;
grant select on public.document_review_overview to authenticated;

-- Existing clients already subscribe to documents. Publish only safe document
-- metadata when a current check changes, not its hidden raw JSON. Avoid taking
-- parent locks behind a concurrent trash/delete transaction (which owns the
-- load before it touches jobs/checks); reconnect refetch remains the fallback.
create function private.notify_document_check_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_document uuid; target_load uuid;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  select d.id,d.load_id into target_document,target_load from public.document_versions v
    join public.documents d on d.id=v.document_id where v.id=new.document_version_id and d.current_version_id=v.id;
  if target_document is null then return new; end if;
  perform 1 from public.loads where id=target_load and trashed_at is null for key share skip locked;
  if not found then return new; end if;
  perform 1 from public.documents where id=target_document for update skip locked;
  if not found then return new; end if;
  update public.documents set updated_at=clock_timestamp() where id=target_document;
  return new;
end $$;
revoke all on function private.notify_document_check_status() from public,anon,authenticated;
create trigger document_check_safe_status_signal after insert or update of status on public.document_checks
for each row execute function private.notify_document_check_status();
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='documents') then
    alter publication supabase_realtime add table public.documents;
  end if;
end $$;
notify pgrst,'reload schema';
