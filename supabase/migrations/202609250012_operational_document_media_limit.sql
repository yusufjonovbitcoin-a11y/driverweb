-- BOL and POD are media collections. Each uploaded file is its own document,
-- while rate confirmations and other document types retain version history.
create or replace function public.begin_document_upload(
  load_id uuid,
  stop_id uuid,
  document_type text,
  file_name text,
  mime_type text,
  size_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  target_document public.documents;
  new_version_id uuid := gen_random_uuid();
  next_version integer;
  media_count integer;
  storage_path text;
begin
  select * into target_load
  from public.loads
  where id = load_id and company_id = actor.company_id
  for update;

  if target_load.id is null then raise exception 'Load not found'; end if;
  if actor.role = 'driver' and not exists (
    select 1 from public.assignments
    where id = target_load.current_assignment_id
      and driver_id = actor.id
      and status = 'active'
  ) then raise exception 'This load is not assigned to you'; end if;
  if actor.role not in ('driver', 'dispatcher', 'company_admin') then
    raise exception 'Permission denied';
  end if;
  if stop_id is not null and not exists (
    select 1 from public.load_stops
    where id = stop_id and load_stops.load_id = target_load.id
  ) then raise exception 'Stop does not belong to load'; end if;

  if document_type in ('bol', 'pod') then
    select count(*) into media_count
    from public.documents d
    where d.load_id = target_load.id
      and d.stop_id is not distinct from begin_document_upload.stop_id
      and d.document_type = begin_document_upload.document_type;

    if media_count >= 10 then
      raise exception 'A maximum of 10 files is allowed for each BOL or POD section';
    end if;

    insert into public.documents(
      company_id,
      load_id,
      stop_id,
      document_type,
      created_by
    ) values (
      actor.company_id,
      target_load.id,
      stop_id,
      document_type,
      actor.id
    ) returning * into target_document;
  else
    select * into target_document
    from public.documents d
    where d.load_id = target_load.id
      and d.stop_id is not distinct from begin_document_upload.stop_id
      and d.document_type = begin_document_upload.document_type
    order by d.created_at
    limit 1;

    if target_document.id is null then
      insert into public.documents(
        company_id,
        load_id,
        stop_id,
        document_type,
        created_by
      ) values (
        actor.company_id,
        target_load.id,
        stop_id,
        document_type,
        actor.id
      ) returning * into target_document;
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.document_versions
  where document_id = target_document.id;

  storage_path := concat(
    actor.company_id,
    '/',
    target_load.id,
    '/',
    target_document.id,
    '/',
    new_version_id,
    '/',
    regexp_replace(file_name, '[^a-zA-Z0-9._-]', '_', 'g')
  );

  insert into public.document_versions(
    id,
    company_id,
    document_id,
    version_number,
    file_name,
    mime_type,
    storage_path,
    size_bytes,
    is_original,
    uploaded_by
  ) values (
    new_version_id,
    actor.company_id,
    target_document.id,
    next_version,
    file_name,
    mime_type,
    storage_path,
    size_bytes,
    next_version = 1,
    actor.id
  );

  return jsonb_build_object(
    'documentId', target_document.id,
    'versionId', new_version_id,
    'versionNumber', next_version,
    'storagePath', storage_path,
    'bucket', 'load-documents'
  );
end;
$$;

comment on function public.begin_document_upload(uuid, uuid, text, text, text, bigint)
is 'Starts an authenticated document upload. BOL/POD are capped at 10 files per load and stop; other types keep version history.';
