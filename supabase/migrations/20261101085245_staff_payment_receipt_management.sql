-- Load-level payment receipts can be added, replaced and removed by authorized staff.
-- Retain immutable file history, tenant/scope checks and optimistic upload commits.
-- Uploading a receipt does not confirm a payment or complete a trip.

create or replace function public.begin_staff_document_upload(p_load_id uuid,p_document_type text,p_stop_id uuid,
  p_document_id uuid,p_expected_current_version_id uuid,p_file_name text,p_mime_type text,
  p_size_bytes bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.loads; d public.documents; stop public.load_stops; change private.staff_document_changes;
  actor uuid:=(select auth.uid()); request jsonb; version_id uuid:=gen_random_uuid(); version_number integer;
  storage_path text; response jsonb; media_count integer;
begin
  l:=private.lock_staff_document_load(p_load_id);
  if p_operation_id is null then raise exception 'STAFF_DOCUMENT_OPERATION_REQUIRED'; end if;
  if p_document_type not in ('rate_confirmation','bol','pod','receipt') or p_document_type is null then raise exception 'STAFF_DOCUMENT_TYPE_INVALID'; end if;
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
  elsif p_document_type in ('rate_confirmation','receipt') then
    select * into d from public.documents where load_id=l.id and document_type=p_document_type
      order by (current_version_id is not null) desc,created_at,id limit 1 for update;
  end if;
  if d.current_version_id is distinct from p_expected_current_version_id then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  if p_document_type in ('rate_confirmation','receipt') then
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

create or replace function public.remove_staff_load_document(p_load_id uuid,p_document_id uuid,p_expected_current_version_id uuid,p_operation_id uuid)
returns public.documents language plpgsql security definer set search_path='' as $$
declare l public.loads; d public.documents; change private.staff_document_changes; request jsonb;
begin
  l:=private.lock_staff_document_load(p_load_id);
  if p_operation_id is null or p_expected_current_version_id is null then raise exception 'STAFF_DOCUMENT_CONFLICT'; end if;
  select * into d from public.documents where id=p_document_id and load_id=l.id and company_id=l.company_id for update;
  if d.id is null or d.document_type not in ('rate_confirmation','bol','pod','receipt') then raise exception 'STAFF_DOCUMENT_PERMISSION_DENIED'; end if;
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

-- Staff receipts use the same version/operation checks as BOL, POD and Rate Con.
-- Driver clients keep their existing receipt workflow.
do $migration$
declare signature text; definition text;
  before_types text := '(''rate_confirmation'',''bol'',''pod'')';
  after_types text := '(''rate_confirmation'',''bol'',''pod'',''receipt'')';
begin
  foreach signature in array array[
    'public.begin_document_upload(uuid,uuid,text,text,text,bigint)',
    'public.bind_document_version_media(uuid,text,text)',
    'public.complete_document_upload(uuid,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition, before_types) = 0 then
      raise exception 'Unexpected staff document guard in %', signature;
    end if;
    execute replace(definition, before_types, after_types);
  end loop;
end $migration$;
