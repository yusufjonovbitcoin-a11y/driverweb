-- A source import is not a general staff document replacement. Bind only the
-- original bytes of one server-created import to its still-unassigned draft.
-- Storage bytes are uploaded/read through Storage API, never written by SQL.
create table private.import_document_uploads (
  import_id uuid primary key references public.manual_load_imports(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  actor_id uuid not null references public.profiles(id),
  load_id uuid not null references public.loads(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id uuid unique references public.document_versions(id) on delete set null,
  checksum_sha256 text not null,
  content_revision bigint not null,
  execution_reset_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index import_document_uploads_document_idx on private.import_document_uploads(document_id);
create index import_document_uploads_load_idx on private.import_document_uploads(load_id);
alter table private.import_document_uploads enable row level security;
revoke all on private.import_document_uploads from public,anon,authenticated,service_role;

create function private.lock_source_document_import(p_import_id uuid,p_expected_checksum text,p_actor_id uuid)
returns public.manual_load_imports language plpgsql security definer set search_path='' as $$
declare actor public.profiles; imported public.manual_load_imports; l public.loads;
begin
  select * into actor from public.profiles where id=p_actor_id for share;
  if actor.id is null or actor.status<>'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'IMPORT_DOCUMENT_PERMISSION_DENIED'; end if;
  if p_expected_checksum is null or p_expected_checksum !~ '^[a-f0-9]{64}$' then raise exception 'IMPORT_DOCUMENT_SOURCE_MISMATCH'; end if;
  -- Same parent -> import order as save_import_ordered_stops and draft refresh.
  select l0.* into l from public.loads l0 join public.manual_load_imports i on i.load_id=l0.id
    where i.id=p_import_id and i.company_id=actor.company_id and i.created_by=actor.id for update of l0;
  select * into imported from public.manual_load_imports where id=p_import_id for update;
  if l.id is null or imported.company_id is distinct from actor.company_id or imported.created_by is distinct from actor.id
    or imported.load_id is distinct from l.id or l.company_id is distinct from actor.company_id then
    raise exception 'IMPORT_DOCUMENT_PERMISSION_DENIED'; end if;
  if imported.checksum_sha256 is distinct from p_expected_checksum
    or imported.status not in ('processing','parse_failed','extracted','needs_review')
    or imported.mime_type not in ('application/pdf','image/jpeg','image/png','image/webp','image/gif')
    or nullif(btrim(imported.source_file_name),'') is null or length(imported.source_file_name)>255
    or imported.size_bytes not between 1 and 52428800 then raise exception 'IMPORT_DOCUMENT_SOURCE_MISMATCH'; end if;
  if l.trashed_at is not null or l.execution_reset_at is not null or l.status not in ('draft','review')
    or l.current_assignment_id is not null or nullif(l.driver_brief->>'reviewedAt','') is not null
    or exists(select 1 from public.assignments where load_id=l.id)
    or exists(select 1 from public.offers where load_id=l.id) then raise exception 'IMPORT_DOCUMENT_LOAD_NOT_DRAFT'; end if;
  return imported;
end $$;
revoke all on function private.lock_source_document_import(uuid,text,uuid) from public,anon,authenticated,service_role;

create function private.source_document_object_matches(p_path text,p_actor_id uuid,p_size bigint,p_mime text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from storage.objects o where o.bucket_id='load-documents' and o.name=p_path
    and o.owner_id=p_actor_id::text
    and (case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric end)=p_size
    and lower(btrim(split_part(o.metadata->>'mimetype',';',1)))=p_mime);
$$;
revoke all on function private.source_document_object_matches(text,uuid,bigint,text) from public,anon,authenticated,service_role;

create function public.begin_import_document_upload(p_import_id uuid,p_expected_checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare imported public.manual_load_imports; d public.documents; v public.document_versions;
  upload private.import_document_uploads; actor_id uuid:=(select auth.uid());
  new_version_id uuid; next_version integer; source_exists boolean;
begin
  imported:=private.lock_source_document_import(p_import_id,p_expected_checksum,actor_id);
  select * into upload from private.import_document_uploads where import_id=imported.id for update;
  if upload.import_id is not null then
    select * into d from public.documents where id=upload.document_id for update;
    select * into v from public.document_versions where id=upload.version_id for update;
    if upload.actor_id<>actor_id or upload.company_id<>imported.company_id or upload.load_id<>imported.load_id
      or upload.checksum_sha256<>p_expected_checksum or d.id is null or d.load_id<>imported.load_id
      or d.removed_at is not null or d.document_type<>'rate_confirmation' or d.stop_id is not null then
      raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    if upload.completed_at is not null then
      if d.current_version_id is distinct from v.id or d.content_revision<>upload.content_revision
        or v.superseded_at is not null or v.upload_lease_started_at is not null
        or v.checksum_sha256 is distinct from p_expected_checksum then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    elsif d.current_version_id is not null or d.content_revision<>upload.content_revision then raise exception 'IMPORT_DOCUMENT_CONFLICT';
    end if;
  else
    -- Never resurrect a source explicitly removed/replaced by staff. A legacy
    -- original can be adopted only with the same trusted import provenance.
    if exists(select 1 from public.documents x where x.load_id=imported.load_id and x.document_type='rate_confirmation'
      and (x.removed_at is not null or x.content_revision>1 or x.current_version_id is null)) then
      raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    if (select count(*) from public.documents x where x.load_id=imported.load_id and x.document_type='rate_confirmation'
      and x.current_version_id is not null)>1 then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    select * into d from public.documents x where x.load_id=imported.load_id and x.document_type='rate_confirmation'
      and x.current_version_id is not null for update;
    if d.id is not null then
      select * into v from public.document_versions where id=d.current_version_id for update;
      if d.created_by<>actor_id or d.stop_id is not null or v.id is null or not v.is_original
        or v.uploaded_by<>actor_id or v.superseded_at is not null or v.upload_lease_started_at is not null
        or v.upload_expires_at is not null or v.checksum_sha256 is distinct from p_expected_checksum
        or v.file_name<>imported.source_file_name or v.mime_type<>imported.mime_type or v.size_bytes is distinct from imported.size_bytes
        or (imported.storage_path is not null and imported.storage_path<>v.storage_path)
        or v.storage_path like 'cloudinary:%' then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    else
      if imported.storage_path is not null then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
      -- A new draft has no other source session. Never race another staff
      -- document operation or silently reuse its pending version.
      insert into public.documents(company_id,load_id,document_type,created_by)
        values(imported.company_id,imported.load_id,'rate_confirmation',actor_id) returning * into d;
    end if;
    insert into private.import_document_uploads(import_id,company_id,actor_id,load_id,document_id,version_id,
      checksum_sha256,content_revision,completed_at)
    values(imported.id,imported.company_id,actor_id,imported.load_id,d.id,v.id,p_expected_checksum,d.content_revision,
      case when v.id is not null then now() end) returning * into upload;
  end if;
  if upload.completed_at is null and (v.id is null or v.upload_expires_at<=clock_timestamp()) then
    if v.id is not null and v.upload_lease_started_at is null then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    select coalesce(max(version_number),0)+1 into next_version from public.document_versions where document_id=d.id;
    new_version_id:=gen_random_uuid();
    insert into public.document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,
      size_bytes,is_original,uploaded_by,upload_lease_started_at,upload_expires_at)
    values(new_version_id,imported.company_id,d.id,next_version,imported.source_file_name,imported.mime_type,
      imported.company_id||'/'||imported.load_id||'/'||d.id||'/'||new_version_id||'/'||regexp_replace(imported.source_file_name,'[^a-zA-Z0-9._-]','_','g'),
      imported.size_bytes,true,actor_id,now(),now()+interval '1 hour') returning * into v;
    update private.import_document_uploads set version_id=v.id where import_id=imported.id;
  end if;
  if v.id is null or v.document_id<>d.id or v.uploaded_by<>actor_id or v.company_id<>imported.company_id
    or v.file_name<>imported.source_file_name or v.mime_type<>imported.mime_type or v.size_bytes is distinct from imported.size_bytes
    or v.superseded_at is not null then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
  source_exists:=private.source_document_object_matches(v.storage_path,actor_id,imported.size_bytes,imported.mime_type);
  if not source_exists and (upload.completed_at is not null or exists(select 1 from storage.objects
    where bucket_id='load-documents' and name=v.storage_path)) then raise exception 'IMPORT_DOCUMENT_FILE_MISMATCH'; end if;
  return jsonb_build_object('documentId',d.id,'versionId',v.id,'versionNumber',v.version_number,'storagePath',v.storage_path,
    'bucket','load-documents','uploadExpiresAt',v.upload_expires_at,'alreadyUploaded',source_exists);
end $$;
revoke all on function public.begin_import_document_upload(uuid,text) from public,anon,service_role;
grant execute on function public.begin_import_document_upload(uuid,text) to authenticated;

-- Only the Edge handler may attest that freshly uploaded/reused object bytes
-- match SHA-256. The handler authenticates p_actor_id and hashes reused bytes;
-- SQL independently rechecks actor/source/scope/object metadata and lifecycle.
create function public.complete_import_document_upload(p_import_id uuid,p_version_id uuid,p_expected_checksum text,p_actor_id uuid)
returns public.documents language plpgsql security definer set search_path='' as $$
declare imported public.manual_load_imports; d public.documents; v public.document_versions;
  upload private.import_document_uploads;
begin
  imported:=private.lock_source_document_import(p_import_id,p_expected_checksum,p_actor_id);
  select * into upload from private.import_document_uploads where import_id=imported.id for update;
  select * into d from public.documents where id=upload.document_id for update;
  select * into v from public.document_versions where id=upload.version_id for update;
  if upload.import_id is null or upload.actor_id<>p_actor_id or upload.company_id<>imported.company_id
    or upload.load_id<>imported.load_id or upload.checksum_sha256<>p_expected_checksum
    or upload.version_id is distinct from p_version_id or d.id is null or d.removed_at is not null
    or d.load_id<>imported.load_id or d.company_id<>imported.company_id or d.document_type<>'rate_confirmation'
    or d.stop_id is not null or v.id is null or v.document_id<>d.id or v.company_id<>imported.company_id
    or v.uploaded_by<>p_actor_id or v.superseded_at is not null or v.file_name<>imported.source_file_name
    or v.mime_type<>imported.mime_type or v.size_bytes is distinct from imported.size_bytes
    or not private.source_document_object_matches(v.storage_path,p_actor_id,imported.size_bytes,imported.mime_type)
    then raise exception 'IMPORT_DOCUMENT_FILE_MISMATCH'; end if;
  if upload.completed_at is not null then
    if d.current_version_id is distinct from v.id or d.content_revision<>upload.content_revision
      or v.checksum_sha256 is distinct from p_expected_checksum or v.upload_lease_started_at is not null then
      raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
    return d;
  end if;
  if d.current_version_id is not null or d.content_revision<>upload.content_revision
    or exists(select 1 from public.documents other where other.load_id=imported.load_id
      and other.document_type='rate_confirmation' and other.id<>d.id) then raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
  if v.upload_lease_started_at is null or v.upload_expires_at is null or v.upload_expires_at<=clock_timestamp() then
    raise exception 'IMPORT_DOCUMENT_UPLOAD_EXPIRED'; end if;
  update public.document_versions set checksum_sha256=p_expected_checksum,upload_lease_started_at=null,upload_expires_at=null where id=v.id;
  update public.documents set current_version_id=v.id where id=d.id returning * into d;
  insert into public.document_checks(company_id,document_version_id) values(imported.company_id,v.id);
  insert into public.jobs(company_id,type,payload,idempotency_key) values(imported.company_id,'document.ai_check',
    jsonb_build_object('documentVersionId',v.id,'loadId',d.load_id),'document-check:'||v.id) on conflict(idempotency_key) do nothing;
  update public.manual_load_imports set storage_path=v.storage_path where id=imported.id;
  update private.import_document_uploads set completed_at=now(),content_revision=d.content_revision where import_id=imported.id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value,metadata)
  values(imported.company_id,p_actor_id,'document.import_source_uploaded','document',d.id,
    jsonb_build_object('versionId',v.id),jsonb_build_object('importId',imported.id,'loadId',d.load_id));
  return d;
end $$;
revoke all on function public.complete_import_document_upload(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_import_document_upload(uuid,uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
