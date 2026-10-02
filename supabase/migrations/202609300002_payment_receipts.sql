-- Driver payment receipts are load-scoped operational documents. A load keeps
-- one current receipt; uploading a replacement creates a new immutable version.

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'rate_confirmation', 'bol', 'pod', 'receipt', 'invoice', 'photo', 'other'
  )) not valid;

alter table public.documents
  validate constraint documents_document_type_check;

create or replace function public.normalize_document_type(legacy_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(btrim(legacy_type)) in (
      'rate_confirmation', 'rate confirmation', 'rate-confirmation', 'ratecon'
    ) then 'rate_confirmation'
    when lower(btrim(legacy_type)) in ('bol', 'bill of lading') then 'bol'
    when lower(btrim(legacy_type)) in ('pod', 'proof of delivery') then 'pod'
    when lower(btrim(legacy_type)) in (
      'receipt', 'payment receipt', 'expense receipt', 'check', 'cheque'
    ) then 'receipt'
    when lower(btrim(legacy_type)) = 'invoice' then 'invoice'
    when lower(btrim(legacy_type)) in ('photo', 'image') then 'photo'
    else 'other'
  end;
$$;

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
  target_stop public.load_stops;
  target_document public.documents;
  new_version_id uuid := gen_random_uuid();
  next_version integer;
  active_media_count integer;
  storage_path text;
  lease_expires_at timestamptz := now() + interval '1 hour';
begin
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active profile required';
  end if;
  if document_type not in (
    'rate_confirmation', 'bol', 'pod', 'receipt', 'invoice', 'photo', 'other'
  ) then
    raise exception 'Unsupported document type';
  end if;
  if nullif(trim(file_name), '') is null or nullif(trim(mime_type), '') is null then
    raise exception 'File name and MIME type are required';
  end if;
  if size_bytes is not null and size_bytes < 0 then
    raise exception 'File size cannot be negative';
  end if;

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

  if stop_id is not null then
    select * into target_stop
    from public.load_stops s
    where s.id = stop_id
      and s.load_id = target_load.id
      and s.company_id = actor.company_id;
    if target_stop.id is null then raise exception 'Stop does not belong to load'; end if;
  end if;

  if document_type = 'bol' and (target_stop.id is null or target_stop.type <> 'pickup') then
    raise exception 'BOL must belong to a pickup stop';
  end if;
  if document_type = 'pod' and (target_stop.id is null or target_stop.type <> 'delivery') then
    raise exception 'POD must belong to a delivery stop';
  end if;
  if document_type = 'receipt' and target_stop.id is not null then
    raise exception 'Payment receipt must belong to the load, not a stop';
  end if;

  delete from public.document_versions v
  using public.documents d
  where v.document_id = d.id
    and d.load_id = target_load.id
    and d.stop_id is not distinct from begin_document_upload.stop_id
    and d.document_type = begin_document_upload.document_type
    and d.current_version_id is distinct from v.id
    and v.upload_lease_started_at is not null
    and v.upload_expires_at <= now();

  delete from public.documents d
  where d.load_id = target_load.id
    and d.stop_id is not distinct from begin_document_upload.stop_id
    and d.document_type = begin_document_upload.document_type
    and d.current_version_id is null
    and not exists (
      select 1 from public.document_versions v where v.document_id = d.id
    );

  if document_type in ('bol', 'pod') then
    select count(*) into active_media_count
    from public.documents d
    where d.load_id = target_load.id
      and d.stop_id is not distinct from begin_document_upload.stop_id
      and d.document_type = begin_document_upload.document_type
      and (
        d.current_version_id is not null
        or exists (
          select 1
          from public.document_versions v
          where v.document_id = d.id
            and v.upload_lease_started_at is not null
            and v.upload_expires_at > now()
        )
      );

    if active_media_count >= 10 then
      raise exception 'A maximum of 10 files is allowed for each BOL or POD section';
    end if;

    insert into public.documents(company_id, load_id, stop_id, document_type, created_by)
    values (actor.company_id, target_load.id, stop_id, document_type, actor.id)
    returning * into target_document;
  else
    select * into target_document
    from public.documents d
    where d.load_id = target_load.id
      and d.stop_id is not distinct from begin_document_upload.stop_id
      and d.document_type = begin_document_upload.document_type
    order by d.created_at
    limit 1;

    if target_document.id is null then
      insert into public.documents(company_id, load_id, stop_id, document_type, created_by)
      values (actor.company_id, target_load.id, stop_id, document_type, actor.id)
      returning * into target_document;
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.document_versions where document_id = target_document.id;

  storage_path := concat(
    actor.company_id, '/', target_load.id, '/', target_document.id, '/',
    new_version_id, '/', regexp_replace(file_name, '[^a-zA-Z0-9._-]', '_', 'g')
  );

  insert into public.document_versions(
    id, company_id, document_id, version_number, file_name, mime_type,
    storage_path, size_bytes, is_original, uploaded_by, upload_expires_at,
    upload_lease_started_at
  ) values (
    new_version_id, actor.company_id, target_document.id, next_version,
    file_name, mime_type, storage_path, size_bytes, next_version = 1,
    actor.id, lease_expires_at, now()
  );

  return jsonb_build_object(
    'documentId', target_document.id,
    'versionId', new_version_id,
    'versionNumber', next_version,
    'storagePath', storage_path,
    'bucket', 'load-documents',
    'uploadExpiresAt', lease_expires_at
  );
end;
$$;

create or replace function public.delete_operational_document(
  target_document_id uuid
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_document public.documents;
  storage_paths text[];
begin
  select d.*
  into target_document
  from public.documents d
  where d.id = target_document_id
    and d.company_id = actor.company_id
  for update;

  if target_document.id is null then
    raise exception using errcode = 'P0002', message = 'Document not found';
  end if;

  if target_document.document_type not in ('bol', 'pod', 'receipt') then
    raise exception using
      errcode = '55000',
      message = 'Only BOL, POD, or payment receipt media can be deleted';
  end if;

  if actor.role = 'driver' then
    if not exists (
      select 1
      from public.loads l
      join public.assignments a on a.id = l.current_assignment_id
      where l.id = target_document.load_id
        and a.driver_id = actor.id
        and a.status = 'active'
    ) then
      raise exception using
        errcode = '42501',
        message = 'The load is not actively assigned to this driver';
    end if;
  elsif actor.role not in ('company_admin', 'dispatcher') then
    raise exception using errcode = '42501', message = 'Permission denied';
  end if;

  select coalesce(
    array_agg(v.storage_path order by v.version_number),
    array[]::text[]
  )
  into storage_paths
  from public.document_versions v
  where v.document_id = target_document.id;

  insert into public.audit_events (
    company_id, actor_id, action, entity_type, entity_id, old_value, metadata
  )
  values (
    target_document.company_id,
    actor.id,
    'document.deleted',
    'document',
    target_document.id,
    to_jsonb(target_document),
    jsonb_build_object(
      'load_id', target_document.load_id,
      'document_type', target_document.document_type,
      'storage_paths', to_jsonb(storage_paths)
    )
  );

  delete from public.documents d where d.id = target_document.id;
  return storage_paths;
end;
$$;

revoke all on function public.delete_operational_document(uuid)
from public, anon;
grant execute on function public.delete_operational_document(uuid)
to authenticated;

comment on function public.delete_operational_document(uuid)
is 'Deletes BOL, POD, or payment receipt media for an assigned driver or privileged company member, records audit evidence, and returns cleanup paths.';
