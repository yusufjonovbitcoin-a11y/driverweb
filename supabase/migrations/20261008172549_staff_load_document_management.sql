-- Versioned staff document management. Original bytes and prior versions are
-- retained; these commands never alter extraction, prices or compensation.
alter table public.documents add column content_revision bigint not null default 0,
  add column removed_at timestamptz, add column removed_by uuid references public.profiles(id);
create table private.staff_document_changes (
  operation_id uuid primary key, company_id uuid not null, actor_id uuid not null,
  load_id uuid not null references public.loads(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id uuid references public.document_versions(id) on delete cascade,
  action text not null check(action in ('upload','remove')), request jsonb not null,
  expected_revision bigint not null, expected_version_id uuid, execution_reset_at timestamptz,
  applying boolean not null default false, completed_at timestamptz,
  response jsonb, created_at timestamptz not null default now()
);
create unique index staff_document_changes_version_idx on private.staff_document_changes(version_id) where version_id is not null;
create index staff_document_changes_document_idx on private.staff_document_changes(document_id);
alter table private.staff_document_changes enable row level security;
revoke all on private.staff_document_changes from public,anon,authenticated,service_role;

create function private.lock_staff_document_load(p_load_id uuid) returns public.loads
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); l public.loads; driver uuid;
begin
  if actor.id is null or actor.status<>'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
  select * into l from public.loads where id=p_load_id and company_id=actor.company_id for update;
  if l.id is null or not public.can_access_load(l.id) then raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
  if l.trashed_at is not null then raise exception 'LOAD_TRASHED'; end if;
  select driver_id into driver from public.assignments where id=l.current_assignment_id and load_id=l.id;
  if driver is not null and not public.can_access_driver(driver) then raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
  return l;
end $$;
revoke all on function private.lock_staff_document_load(uuid) from public,anon,authenticated,service_role;

create function private.authorized_staff_document_change(p_document_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.staff_document_changes c join public.profiles p on p.id=c.actor_id
    where c.document_id=p_document_id and c.applying and c.completed_at is null
      and c.actor_id=(select auth.uid()) and p.status='active' and p.role in ('company_admin','dispatcher')
      and p.company_id=c.company_id);
$$;
revoke all on function private.authorized_staff_document_change(uuid) from public,anon,authenticated,service_role;
-- Private, transaction-scoped authorization cannot be imitated with a client GUC.
do $migration$
declare definition text:=pg_get_functiondef('public.prevent_required_document_evidence_update()'::regprocedure);
begin
  if strpos(definition,E'begin\n')=0 then raise exception 'Unexpected document evidence guard'; end if;
  execute replace(definition,E'begin\n',E'begin\n  if private.authorized_staff_document_change(old.id) then return new; end if;\n');
end $migration$;

create function private.revise_document_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.current_version_id is distinct from old.current_version_id or new.removed_at is distinct from old.removed_at then
    new.content_revision:=old.content_revision+1;
  else new.content_revision:=old.content_revision; end if;
  return new;
end $$;
revoke all on function private.revise_document_content() from public,anon,authenticated,service_role;
create trigger documents_content_revision before update on public.documents
for each row execute function private.revise_document_content();

create function private.retire_document_reviews(p_document_id uuid,p_keep_version_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Parent/document lock already held; workers finish in the same order.
  update public.jobs j set status='completed',locked_at=null,locked_by=null,last_error=null,updated_at=now()
    where j.type='document.ai_check' and exists(select 1 from public.document_versions v
      where v.document_id=p_document_id and v.id::text=j.payload->>'documentVersionId'
        and v.id is distinct from p_keep_version_id) and j.status<>'completed';
  update public.warnings w set is_active=false where w.is_active and exists(
    select 1 from public.document_checks c join public.document_versions v on v.id=c.document_version_id
    where c.id=w.document_check_id and v.document_id=p_document_id and v.id is distinct from p_keep_version_id);
end $$;
revoke all on function private.retire_document_reviews(uuid,uuid) from public,anon,authenticated,service_role;

create function private.signal_document_content_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.current_version_id is not distinct from old.current_version_id and new.removed_at is not distinct from old.removed_at then return new; end if;
  perform private.retire_document_reviews(new.id,new.current_version_id);
  update public.loads set version=version+1 where id=new.load_id;
  -- Also signal non-private drivers; the existing load trigger signals private ones.
  update public.assignments a set load_revision=load_revision+1 from public.loads l
    where l.id=new.load_id and a.id=l.current_assignment_id;
  return new;
end $$;
revoke all on function private.signal_document_content_change() from public,anon,authenticated,service_role;
create trigger documents_content_signal after update of current_version_id,removed_at on public.documents
for each row execute function private.signal_document_content_change();

create function public.begin_staff_document_upload(p_load_id uuid,p_document_type text,p_stop_id uuid,
  p_document_id uuid,p_expected_current_version_id uuid,p_file_name text,p_mime_type text,
  p_size_bytes bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.loads; d public.documents; stop public.load_stops; change private.staff_document_changes;
  actor uuid:=(select auth.uid()); request jsonb; version_id uuid:=gen_random_uuid(); version_number integer;
  storage_path text; response jsonb; media_count integer;
begin
  l:=private.lock_staff_document_load(p_load_id);
  if p_operation_id is null then raise exception 'STAFF_DOCUMENT_OPERATION_REQUIRED'; end if;
  if p_document_type not in ('rate_confirmation','bol','pod') or p_document_type is null then raise exception 'STAFF_DOCUMENT_TYPE_INVALID'; end if;
  if nullif(btrim(p_file_name),'') is null or length(p_file_name)>255
    or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')
    or p_mime_type is null or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>52428800 then
    raise exception 'STAFF_DOCUMENT_FILE_INVALID'; end if;
  request:=jsonb_build_object('loadId',p_load_id,'type',p_document_type,'stopId',p_stop_id,'documentId',p_document_id,
    'expectedVersionId',p_expected_current_version_id,'fileName',p_file_name,'mimeType',p_mime_type,'sizeBytes',p_size_bytes);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,314159));
  select * into change from private.staff_document_changes where operation_id=p_operation_id;
  if change.operation_id is not null then
    if change.actor_id<>actor or change.company_id<>l.company_id or change.action<>'upload' or change.request<>request then
      raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
    if change.completed_at is null and not exists(select 1 from public.document_versions v where v.id=change.version_id
      and v.upload_expires_at>clock_timestamp()) then raise exception 'STAFF_DOCUMENT_UPLOAD_EXPIRED'; end if;
    return change.response;
  end if;
  if p_document_id is not null then
    select * into d from public.documents where id=p_document_id and load_id=l.id and company_id=l.company_id for update;
    if d.id is null or d.document_type<>p_document_type or (p_stop_id is not null and d.stop_id is distinct from p_stop_id) then
      raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  elsif p_expected_current_version_id is not null then raise exception 'STAFF_DOCUMENT_CONFLICT';
  elsif p_document_type='rate_confirmation' then
    select * into d from public.documents where load_id=l.id and document_type=p_document_type
      order by (current_version_id is not null) desc,created_at,id limit 1 for update;
  end if;
  if d.current_version_id is distinct from p_expected_current_version_id then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  if p_document_type='rate_confirmation' then
    if p_stop_id is not null or d.stop_id is not null then raise exception 'STAFF_DOCUMENT_STOP_INVALID'; end if;
  else
    select * into stop from public.load_stops where id=coalesce(d.stop_id,p_stop_id) and load_id=l.id and company_id=l.company_id;
    if stop.id is null then raise exception 'STAFF_DOCUMENT_STOP_REQUIRED'; end if;
    if stop.type::text<>(case when p_document_type='bol' then 'pickup' else 'delivery' end) then raise exception 'STAFF_DOCUMENT_STOP_INVALID'; end if;
    if d.id is not null and d.stop_id is null then raise exception 'STAFF_DOCUMENT_STOP_REQUIRED'; end if;
    if d.id is null or d.removed_at is not null or not exists(select 1 from public.document_versions v
      where v.id=d.current_version_id and (l.execution_reset_at is null or v.uploaded_at>=l.execution_reset_at)) then
      select count(*) into media_count from public.documents x where x.load_id=l.id and x.stop_id=stop.id
        and x.document_type=p_document_type and x.removed_at is null and
        ((x.current_version_id is not null and exists(select 1 from public.document_versions v where v.id=x.current_version_id
          and (l.execution_reset_at is null or v.uploaded_at>=l.execution_reset_at)))
          or exists(select 1 from public.document_versions v where v.document_id=x.id and v.upload_expires_at>now()));
      if media_count>=10 then raise exception 'STAFF_DOCUMENT_LIMIT_REACHED'; end if;
    end if;
  end if;
  if d.id is null then
    insert into public.documents(company_id,load_id,stop_id,document_type,created_by)
      values(l.company_id,l.id,stop.id,p_document_type,actor) returning * into d;
  end if;
  select coalesce(max(v.version_number),0)+1 into version_number from public.document_versions v where document_id=d.id;
  storage_path:=l.company_id||'/'||l.id||'/'||d.id||'/'||version_id||'/'||regexp_replace(p_file_name,'[^a-zA-Z0-9._-]','_','g');
  insert into public.document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,size_bytes,
    is_original,uploaded_by,upload_lease_started_at,upload_expires_at)
  values(version_id,l.company_id,d.id,version_number,p_file_name,p_mime_type,storage_path,p_size_bytes,
    version_number=1,actor,now(),now()+interval '1 hour');
  response:=jsonb_build_object('documentId',d.id,'versionId',version_id,'versionNumber',version_number,
    'storagePath',storage_path,'bucket','load-documents','uploadExpiresAt',now()+interval '1 hour');
  insert into private.staff_document_changes(operation_id,company_id,actor_id,load_id,document_id,version_id,action,request,
    expected_revision,expected_version_id,execution_reset_at,response)
  values(p_operation_id,l.company_id,actor,l.id,d.id,version_id,'upload',request,d.content_revision,d.current_version_id,l.execution_reset_at,response);
  return response;
end $$;
revoke all on function public.begin_staff_document_upload(uuid,text,uuid,uuid,uuid,text,text,bigint,uuid) from public,anon;
grant execute on function public.begin_staff_document_upload(uuid,text,uuid,uuid,uuid,text,text,bigint,uuid) to authenticated;

create function public.complete_staff_document_upload(p_version_id uuid,p_media_ref text,p_checksum_sha256 text default null)
returns public.documents language plpgsql security definer set search_path='' as $$
declare l public.loads; d public.documents; v public.document_versions; change private.staff_document_changes; asset public.media_assets;
  media_count integer;
begin
  select * into change from private.staff_document_changes where version_id=p_version_id and actor_id=(select auth.uid());
  if change.operation_id is null then raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
  l:=private.lock_staff_document_load(change.load_id);
  select * into d from public.documents where id=change.document_id and load_id=l.id for update;
  select * into v from public.document_versions where id=p_version_id and document_id=d.id for update;
  select * into change from private.staff_document_changes where version_id=p_version_id for update;
  if change.execution_reset_at is distinct from l.execution_reset_at then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  if change.completed_at is not null then
    if d.current_version_id is distinct from v.id or d.removed_at is not null then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
    if v.storage_path is distinct from p_media_ref or v.checksum_sha256 is distinct from p_checksum_sha256 then raise exception 'DOCUMENT_VERSION_IMMUTABLE'; end if;
    return d;
  end if;
  if d.content_revision<>change.expected_revision or d.current_version_id is distinct from change.expected_version_id then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  if v.upload_lease_started_at is null or v.upload_expires_at is null or v.upload_expires_at<=clock_timestamp()
    or v.superseded_at is not null then raise exception 'STAFF_DOCUMENT_UPLOAD_EXPIRED'; end if;
  if d.document_type in ('bol','pod') then
    select count(*) into media_count from public.documents x where x.load_id=l.id and x.stop_id=d.stop_id
      and x.document_type=d.document_type and x.id<>d.id and x.removed_at is null and
      ((x.current_version_id is not null and exists(select 1 from public.document_versions other where other.id=x.current_version_id
        and (l.execution_reset_at is null or other.uploaded_at>=l.execution_reset_at)))
        or exists(select 1 from public.document_versions other where other.document_id=x.id and other.upload_expires_at>now()));
    if media_count>=10 then raise exception 'STAFF_DOCUMENT_LIMIT_REACHED'; end if;
  end if;
  select * into asset from public.media_assets where id=public.cloudinary_media_id(p_media_ref)
    and company_id=l.company_id and uploaded_by=(select auth.uid()) and scope='load_document' and context_id=v.id and deleted_at is null;
  if asset.id is null or asset.mime_type<>v.mime_type or asset.size_bytes<>v.size_bytes then raise exception 'STAFF_DOCUMENT_MEDIA_INVALID'; end if;
  if p_checksum_sha256 is not null and p_checksum_sha256 !~ '^[a-fA-F0-9]{64}$' then raise exception 'STAFF_DOCUMENT_CHECKSUM_INVALID'; end if;
  update private.staff_document_changes set applying=true where operation_id=change.operation_id;
  update public.document_versions set storage_path=p_media_ref,checksum_sha256=p_checksum_sha256,
    upload_lease_started_at=null,upload_expires_at=null where id=v.id;
  update public.documents set current_version_id=v.id,removed_at=null,removed_by=null where id=d.id returning * into d;
  update public.document_versions set superseded_at=now() where document_id=d.id and id<>v.id and superseded_at is null
    and upload_lease_started_at is null;
  insert into public.document_checks(company_id,document_version_id) values(l.company_id,v.id);
  insert into public.jobs(company_id,type,payload,idempotency_key) values(l.company_id,'document.ai_check',
    jsonb_build_object('documentVersionId',v.id,'loadId',l.id),'document-check:'||v.id) on conflict(idempotency_key) do nothing;
  update private.staff_document_changes set applying=false,completed_at=now() where operation_id=change.operation_id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value,metadata)
  values(l.company_id,(select auth.uid()),'document.staff_uploaded','document',d.id,
    jsonb_build_object('versionId',v.id,'replacedVersionId',change.expected_version_id),
    jsonb_build_object('operationId',change.operation_id,'loadId',l.id));
  return d;
end $$;
revoke all on function public.complete_staff_document_upload(uuid,text,text) from public,anon;
grant execute on function public.complete_staff_document_upload(uuid,text,text) to authenticated;

create function public.remove_staff_load_document(p_load_id uuid,p_document_id uuid,p_expected_current_version_id uuid,p_operation_id uuid)
returns public.documents language plpgsql security definer set search_path='' as $$
declare l public.loads; d public.documents; change private.staff_document_changes; request jsonb;
begin
  l:=private.lock_staff_document_load(p_load_id);
  if p_operation_id is null or p_expected_current_version_id is null then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  select * into d from public.documents where id=p_document_id and load_id=l.id and company_id=l.company_id for update;
  if d.id is null or d.document_type not in ('rate_confirmation','bol','pod') then raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
  request:=jsonb_build_object('loadId',p_load_id,'documentId',p_document_id,'expectedVersionId',p_expected_current_version_id);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,314159));
  select * into change from private.staff_document_changes where operation_id=p_operation_id;
  if change.operation_id is not null then
    if change.actor_id<>(select auth.uid()) or change.action<>'remove' or change.request<>request then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
    if d.current_version_id is not null or d.removed_at is null or d.content_revision<>change.expected_revision+1
      or change.execution_reset_at is distinct from l.execution_reset_at then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
    return d;
  end if;
  if d.current_version_id is distinct from p_expected_current_version_id then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  insert into private.staff_document_changes(operation_id,company_id,actor_id,load_id,document_id,action,request,
    expected_revision,expected_version_id,execution_reset_at,applying)
  values(p_operation_id,l.company_id,(select auth.uid()),l.id,d.id,'remove',request,d.content_revision,d.current_version_id,l.execution_reset_at,true);
  update public.documents set current_version_id=null,removed_at=clock_timestamp(),removed_by=(select auth.uid()) where id=d.id returning * into d;
  update public.document_versions set superseded_at=coalesce(superseded_at,now()) where id=p_expected_current_version_id;
  update private.staff_document_changes set applying=false,completed_at=now() where operation_id=p_operation_id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value,metadata)
  values(l.company_id,(select auth.uid()),'document.staff_removed','document',d.id,jsonb_build_object('versionId',p_expected_current_version_id),
    jsonb_build_object('operationId',p_operation_id,'loadId',l.id,'historyRetained',true));
  return d;
end $$;
revoke all on function public.remove_staff_load_document(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.remove_staff_load_document(uuid,uuid,uuid,uuid) to authenticated;

-- A staged staff version may only pass through its optimistic commit command.
do $migration$
declare signature text; definition text; document_variable text;
  anchor text:='  if target_version.id is null then raise exception ''Upload not found''; end if;';
begin
  foreach signature in array array['public.bind_document_version_media(uuid,text,text)','public.complete_document_upload(uuid,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if strpos(definition,anchor)=0 then raise exception 'Unexpected legacy upload command %',signature; end if;
    definition:=replace(definition,anchor,anchor||E'\n  if exists(select 1 from private.staff_document_changes c where c.version_id=target_version.id) then raise exception ''STAFF_DOCUMENT_MANAGEMENT_REQUIRED''; end if;');
    document_variable:=case when signature like '%bind_document%' then 'target_document' else 'result' end;
    anchor:='  select * into '||document_variable||' from public.documents where id=target_version.document_id for update;';
    if strpos(definition,anchor)=0 then raise exception 'Unexpected legacy document lock %',signature; end if;
    definition:=replace(definition,anchor,anchor||format($patch$
  if actor.role in ('company_admin','dispatcher') and %1$s.document_type in ('rate_confirmation','bol','pod') then
    raise exception 'STAFF_DOCUMENT_MANAGEMENT_REQUIRED'; end if;
  if actor.role='driver' and %1$s.document_type='rate_confirmation' then raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
  if %1$s.removed_at is not null then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
$patch$,document_variable));
    execute definition;
    anchor:='  if target_version.id is null then raise exception ''Upload not found''; end if;';
  end loop;
  definition:=pg_get_functiondef('public.begin_document_upload(uuid,uuid,text,text,text,bigint)'::regprocedure);
  anchor:=E'begin\n';
  if strpos(definition,anchor)=0 then raise exception 'Unexpected begin document command'; end if;
  definition:=replace(definition,anchor,anchor||E'  if actor.role=''driver'' and document_type=''rate_confirmation'' then raise exception ''STAFF_DOCUMENT_PERMISSION_DENIED''; end if;\n  if actor.role in (''company_admin'',''dispatcher'') and document_type in (''rate_confirmation'',''bol'',''pod'') then raise exception ''STAFF_DOCUMENT_MANAGEMENT_REQUIRED''; end if;\n');
  anchor:='and d.document_type = begin_document_upload.document_type';
  if strpos(definition,anchor)=0 then raise exception 'Unexpected legacy document selector'; end if;
  -- Do not reuse receipt tombstones or count removed BOL/POD uploads against quota.
  execute replace(definition,anchor,anchor||' and d.removed_at is null');
end $migration$;

-- Drivers retain operational removal, now as a soft removal (no cleanup paths).
-- Staff must supply an expected version through the new API.
create or replace function public.delete_operational_document(target_document_id uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); d public.documents; l public.loads;
begin
  if actor.id is null or actor.status<>'active' then raise exception 'Permission denied'; end if;
  if actor.role in ('company_admin','dispatcher') then raise exception 'STAFF_DOCUMENT_MANAGEMENT_REQUIRED'; end if;
  if actor.role<>'driver' then raise exception 'Permission denied'; end if;
  select * into d from public.documents where id=target_document_id and company_id=actor.company_id;
  select * into l from public.loads where id=d.load_id for update;
  if l.id is null or l.trashed_at is not null or not exists(select 1 from public.assignments a
    where a.id=l.current_assignment_id and a.driver_id=actor.id and a.status='active') then raise exception 'Document access denied'; end if;
  select * into d from public.documents where id=target_document_id for update;
  if d.document_type not in ('bol','pod','receipt') then raise exception 'Permission denied'; end if;
  if d.removed_at is not null then return array[]::text[]; end if;
  -- Existing finalized-evidence UPDATE guard still applies to drivers.
  update public.documents set current_version_id=null,removed_at=clock_timestamp(),removed_by=actor.id where id=d.id;
  update public.document_versions set superseded_at=coalesce(superseded_at,now()) where id=d.current_version_id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
  values(d.company_id,actor.id,'document.driver_removed','document',d.id,jsonb_build_object('versionId',d.current_version_id,'historyRetained',true));
  return array[]::text[];
end $$;
revoke all on function public.delete_operational_document(uuid) from public,anon;
grant execute on function public.delete_operational_document(uuid) to authenticated;

-- Old/removed versions cannot be newly signed by a driver, including shared
-- chat references and legacy Storage paths. Staff retain history. Existing
-- signed URLs expire normally; this does not claim instantaneous revocation.
create or replace function private.hidden_driver_pay_file(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id
   where v.storage_path=p_path and ((d.document_type in ('rate_confirmation','receipt') and private.hide_broker_terms(d.load_id))
    or (public.current_app_role()='driver' and (d.removed_at is not null
      or (d.current_version_id is distinct from v.id and (v.upload_lease_started_at is null or v.uploaded_by<>(select auth.uid())))))));
$$;
create policy documents_removed_driver_privacy on public.documents as restrictive for select to authenticated
using (public.current_app_role()<>'driver' or removed_at is null);

create function private.driver_document_file_visible(p_path text,p_context_id uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_app_role()<>'driver' or exists(
   select 1 from public.document_versions v join public.documents d on d.id=v.document_id
   where (v.storage_path=p_path or v.id=p_context_id) and public.can_access_load(d.load_id)
     and d.removed_at is null
     and (d.document_type not in ('rate_confirmation','receipt') or not private.hide_broker_terms(d.load_id))
     and ((d.current_version_id=v.id and v.superseded_at is null and v.upload_lease_started_at is null)
       or (v.uploaded_by=(select auth.uid()) and v.upload_lease_started_at is not null and v.upload_expires_at>now())));
$$;
revoke all on function private.driver_document_file_visible(text,uuid) from public,anon;
grant execute on function private.driver_document_file_visible(text,uuid) to authenticated;
create policy assets_current_document_driver_privacy on public.media_assets as restrictive for select to authenticated
using (scope<>'load_document' or private.driver_document_file_visible('cloudinary:'||id::text,context_id));
create policy storage_current_document_driver_privacy on storage.objects as restrictive for select to authenticated
using (bucket_id<>'load-documents' or private.driver_document_file_visible(name,null));

-- Leased AI completion must recheck current evidence while holding the parent
-- and document before the job/check locks. A replacement/removal wins atomically.
do $migration$
declare definition text:=pg_get_functiondef('public.finish_document_check(uuid,text,uuid,public.document_check_status,numeric,text,jsonb,jsonb)'::regprocedure);
  anchor text:=E'begin\n';
begin
  if strpos(definition,'review public.document_checks;')=0 or strpos(definition,anchor)=0 then raise exception 'Unexpected document check finisher'; end if;
  definition:=replace(definition,'review public.document_checks;',
    'review public.document_checks; version public.document_versions; document public.documents; parent_load public.loads;');
  execute replace(definition,anchor,anchor||$patch$
  select v.* into version from public.jobs j join public.document_versions v on v.id::text=j.payload->>'documentVersionId'
    where j.id=target_job_id and j.type='document.ai_check';
  select l.* into parent_load from public.loads l join public.documents d on d.load_id=l.id where d.id=version.document_id for update of l;
  select * into document from public.documents where id=version.document_id for update;
  if parent_load.id is null or parent_load.trashed_at is not null or document.removed_at is not null
    or document.current_version_id is distinct from version.id or version.superseded_at is not null
    or version.upload_lease_started_at is not null
    or (parent_load.execution_reset_at is not null and version.uploaded_at<parent_load.execution_reset_at) then return false; end if;
$patch$);
end $migration$;
notify pgrst,'reload schema';
