-- Close operational integrity gaps without changing existing client RPC signatures.
-- This migration is forward-only. All guards apply at the database boundary so
-- service-role and future clients cannot bypass the same invariants.

-- ---------------------------------------------------------------------------
-- Document types and required stop evidence
-- ---------------------------------------------------------------------------

alter table public.documents
  drop constraint if exists documents_document_type_check;

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
    when lower(btrim(legacy_type)) = 'invoice' then 'invoice'
    when lower(btrim(legacy_type)) in ('photo', 'image') then 'photo'
    else 'other'
  end;
$$;

-- Normalize legacy free-text values before enforcing the allowlist. Unknown
-- values are preserved in the audit log and downgraded to `other`, so one
-- legacy row cannot abort the whole deployment.
insert into public.audit_events(
  company_id, actor_id, action, entity_type, entity_id, old_value, new_value,
  metadata
)
select
  d.company_id,
  null,
  'document.type_normalized',
  'document',
  d.id,
  jsonb_build_object('documentType', d.document_type),
  jsonb_build_object(
    'documentType',
    public.normalize_document_type(d.document_type)
  ),
  jsonb_build_object('source', 'migration', 'reason', 'document_type_allowlist')
from public.documents d
where d.document_type is distinct from
  public.normalize_document_type(d.document_type);

update public.documents d
set document_type = public.normalize_document_type(d.document_type)
where d.document_type is distinct from
  public.normalize_document_type(d.document_type);

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'rate_confirmation', 'bol', 'pod', 'invoice', 'photo', 'other'
  )) not valid;

alter table public.documents
  validate constraint documents_document_type_check;

create or replace function public.required_document_type_for_stop(
  target_stop_type public.stop_type
)
returns text
language sql
immutable
set search_path = public
as $$
  select case target_stop_type
    when 'pickup'::public.stop_type then 'bol'
    when 'delivery'::public.stop_type then 'pod'
  end;
$$;

create or replace function public.stop_has_required_document(target_stop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.load_stops s
    join public.documents d
      on d.stop_id = s.id
     and d.load_id = s.load_id
     and d.company_id = s.company_id
     and d.document_type = public.required_document_type_for_stop(s.type)
     and d.current_version_id is not null
    join public.document_versions v
      on v.id = d.current_version_id
     and v.document_id = d.id
     and v.company_id = d.company_id
     and v.superseded_at is null
    where s.id = target_stop_id
  );
$$;

create or replace function public.enforce_stop_required_document()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'done'
     and old.status is distinct from new.status
     and new.requires_document
     and not public.stop_has_required_document(new.id) then
    raise exception using
      errcode = '23514',
      message = case new.type
        when 'pickup'::public.stop_type then 'Required pickup BOL is missing'
        else 'Required delivery POD is missing'
      end;
  end if;
  return new;
end;
$$;

drop trigger if exists load_stops_required_document_guard on public.load_stops;
create trigger load_stops_required_document_guard
before update of status on public.load_stops
for each row execute function public.enforce_stop_required_document();

create or replace function public.enforce_load_completion_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    if exists (
      select 1
      from public.load_stops s
      where s.load_id = new.id
        and s.requires_document
        and (
          s.status <> 'done'
          or not public.stop_has_required_document(s.id)
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'Every required pickup BOL and delivery POD must be present before completion';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loads_completion_document_guard on public.loads;
create trigger loads_completion_document_guard
before update of status on public.loads
for each row execute function public.enforce_load_completion_documents();

create or replace function public.prevent_required_document_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_stop public.load_stops;
  target_load_status public.load_status;
begin
  if old.stop_id is null then
    return old;
  end if;

  select * into target_stop
  from public.load_stops s
  where s.id = old.stop_id;

  select l.status into target_load_status
  from public.loads l
  where l.id = target_stop.load_id;

  if target_stop.id is not null
     and target_stop.requires_document
     and old.current_version_id is not null
     and old.document_type = public.required_document_type_for_stop(target_stop.type)
     and (
       target_stop.status = 'done'
       or target_load_status in ('delivered', 'completed')
     ) then
    raise exception using
      errcode = '23514',
      message = 'Required BOL/POD cannot be deleted after the stop is completed';
  end if;
  return old;
end;
$$;

drop trigger if exists documents_required_delete_guard on public.documents;
create trigger documents_required_delete_guard
before delete on public.documents
for each row execute function public.prevent_required_document_delete();

create or replace function public.prevent_required_document_evidence_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_stop public.load_stops;
  target_load_status public.load_status;
begin
  if old.stop_id is null
     or old.current_version_id is null
     or not (
       old.document_type is distinct from new.document_type
       or old.current_version_id is distinct from new.current_version_id
       or old.stop_id is distinct from new.stop_id
       or old.load_id is distinct from new.load_id
       or old.company_id is distinct from new.company_id
     ) then
    return new;
  end if;

  select * into target_stop
  from public.load_stops s
  where s.id = old.stop_id;

  select l.status into target_load_status
  from public.loads l
  where l.id = target_stop.load_id;

  if target_stop.id is not null
     and target_stop.requires_document
     and old.document_type = public.required_document_type_for_stop(target_stop.type)
     and exists (
       select 1
       from public.document_versions v
       where v.id = old.current_version_id
         and v.document_id = old.id
         and v.company_id = old.company_id
         and v.superseded_at is null
     )
     and (
       target_stop.status = 'done'
       or target_load_status in ('delivered', 'completed')
     ) then
    raise exception using
      errcode = '23514',
      message = 'Required BOL/POD evidence cannot be changed after completion';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_required_update_guard on public.documents;
create trigger documents_required_update_guard
before update of document_type, current_version_id, stop_id, load_id, company_id
on public.documents
for each row execute function public.prevent_required_document_evidence_update();

create or replace function public.prevent_required_document_version_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_document public.documents;
  target_stop public.load_stops;
  target_load_status public.load_status;
begin
  if tg_op = 'UPDATE' and old is not distinct from new then
    return new;
  end if;

  select * into target_document
  from public.documents d
  where d.id = old.document_id
    and d.company_id = old.company_id
    and d.current_version_id = old.id;
  if target_document.id is null or target_document.stop_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into target_stop
  from public.load_stops s
  where s.id = target_document.stop_id
    and s.load_id = target_document.load_id
    and s.company_id = target_document.company_id;
  select l.status into target_load_status
  from public.loads l
  where l.id = target_document.load_id
    and l.company_id = target_document.company_id;

  if target_stop.id is not null
     and target_stop.requires_document
     and target_document.document_type =
       public.required_document_type_for_stop(target_stop.type)
     and (
       target_stop.status = 'done'
       or target_load_status in ('delivered', 'completed')
     ) then
    raise exception using
      errcode = '23514',
      message = 'Finalized BOL/POD version is immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists document_versions_required_mutation_guard
on public.document_versions;
create trigger document_versions_required_mutation_guard
before update or delete on public.document_versions
for each row execute function public.prevent_required_document_version_mutation();

-- ---------------------------------------------------------------------------
-- Expirable document upload lifecycle
-- ---------------------------------------------------------------------------

alter table public.document_versions
  add column if not exists upload_expires_at timestamptz,
  add column if not exists upload_lease_started_at timestamptz;

-- A prior development revision backfilled expiry onto historical versions.
-- Only rows created by begin_document_upload carry an explicit lease marker;
-- historical and superseded versions remain permanent.
update public.document_versions v
set upload_expires_at = null
where v.upload_expires_at is not null
  and v.upload_lease_started_at is null;

create index if not exists document_versions_upload_expiry_idx
  on public.document_versions (upload_expires_at)
  where upload_expires_at is not null;

create or replace function public.cleanup_expired_document_uploads(batch_size integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_versions integer := 0;
begin
  if coalesce(batch_size, 0) < 1 or batch_size > 1000 then
    raise exception 'Batch size must be between 1 and 1000';
  end if;

  with expired as (
    select v.id
    from public.document_versions v
    left join public.documents d on d.current_version_id = v.id
    where v.upload_expires_at <= now()
      and v.upload_lease_started_at is not null
      and d.id is null
    order by v.upload_expires_at, v.id
    limit batch_size
    for update of v skip locked
  )
  delete from public.document_versions v
  using expired e
  where v.id = e.id;

  get diagnostics deleted_versions = row_count;

  delete from public.documents d
  where d.current_version_id is null
    and not exists (
      select 1 from public.document_versions v where v.document_id = d.id
    );

  return deleted_versions;
end;
$$;

create or replace function public.enqueue_abandoned_document_upload_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  media public.media_assets;
  cleanup_payload jsonb;
begin
  if old.upload_lease_started_at is null
     or old.upload_expires_at is null
     or old.upload_expires_at > now() then
    return old;
  end if;

  select * into media
  from public.media_assets m
  where m.scope = 'load_document'
    and m.context_id = old.id
    and m.company_id = old.company_id
    and m.deleted_at is null
  order by m.created_at desc
  limit 1;

  if media.id is not null or old.storage_path like 'cloudinary:%' then
    if media.id is null then
    select * into media
    from public.media_assets m
    where m.id = public.cloudinary_media_id(old.storage_path);
    end if;

    cleanup_payload := jsonb_build_object(
      'provider', 'cloudinary',
      'mediaRef', coalesce(
        case when media.id is not null then concat('cloudinary:', media.id) end,
        old.storage_path
      ),
      'mediaAssetId', media.id,
      'assetId', media.cloudinary_asset_id,
      'publicId', media.public_id,
      'resourceType', media.resource_type,
      'deliveryType', media.delivery_type,
      'documentVersionId', old.id
    );
  else
    cleanup_payload := jsonb_build_object(
      'provider', 'supabase_storage',
      'bucket', 'load-documents',
      'storagePath', old.storage_path,
      'documentVersionId', old.id
    );
  end if;

  insert into public.jobs(company_id, type, payload, idempotency_key)
  values (
    old.company_id,
    'provider.media_delete',
    cleanup_payload,
    concat('abandoned-document-upload:', old.id)
  )
  on conflict (idempotency_key) do nothing;

  return old;
end;
$$;

drop trigger if exists document_versions_abandoned_cleanup
on public.document_versions;
create trigger document_versions_abandoned_cleanup
after delete on public.document_versions
for each row execute function public.enqueue_abandoned_document_upload_cleanup();

revoke all on function public.cleanup_expired_document_uploads(integer)
from public, anon, authenticated;
grant execute on function public.cleanup_expired_document_uploads(integer)
to service_role;

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
    'rate_confirmation', 'bol', 'pod', 'invoice', 'photo', 'other'
  ) then
    raise exception 'Unsupported document type';
  end if;
  if nullif(trim(file_name), '') is null or nullif(trim(mime_type), '') is null then
    raise exception 'File name and MIME type are required';
  end if;
  if size_bytes is not null and size_bytes < 0 then
    raise exception 'File size cannot be negative';
  end if;

  -- Locking the load serializes concurrent limit checks for this aggregate.
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

  -- Remove expired attempts in this exact section. They no longer consume the
  -- ten-file quota even if global cleanup has not run yet.
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

create or replace function public.can_access_load_media_context(
  target_context_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1
      from public.document_versions v
      join public.documents d on d.id = v.document_id
      where v.id = target_context_id
        and v.uploaded_by = (select auth.uid())
        and v.upload_lease_started_at is not null
        and v.upload_expires_at > now()
        and public.can_access_load(d.load_id)
    );
$$;

revoke all on function public.can_access_load_media_context(uuid)
from public, anon;
grant execute on function public.can_access_load_media_context(uuid)
to authenticated;

create or replace function public.bind_document_version_media(
  version_id uuid,
  media_ref text,
  checksum_sha256 text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_version public.document_versions;
  target_document public.documents;
begin
  select * into target_version
  from public.document_versions
  where id = version_id and company_id = actor.company_id
  for update;
  if target_version.id is null or target_version.uploaded_by <> actor.id then
    raise exception 'Upload not found';
  end if;
  if target_version.upload_expires_at is not null
     and target_version.upload_expires_at <= now() then
    raise exception 'Upload session expired';
  end if;

  select * into target_document
  from public.documents
  where id = target_version.document_id and public.can_access_load(load_id)
  for update;
  if target_document.id is null then raise exception 'Document access denied'; end if;
  if not public.is_valid_cloudinary_media(media_ref, 'load_document', target_version.id) then
    raise exception 'Cloudinary media was not found';
  end if;

  update public.document_versions
  set storage_path = media_ref,
      checksum_sha256 = bind_document_version_media.checksum_sha256,
      upload_expires_at = null,
      upload_lease_started_at = null
  where id = target_version.id;
  update public.document_versions
  set superseded_at = now()
  where document_id = target_version.document_id
    and id <> target_version.id
    and superseded_at is null;
  update public.documents
  set current_version_id = target_version.id
  where id = target_version.document_id
  returning * into target_document;
  insert into public.document_checks(company_id, document_version_id)
  values (actor.company_id, target_version.id)
  on conflict do nothing;
  insert into public.jobs(company_id, type, payload, idempotency_key)
  values (
    actor.company_id, 'document.ai_check',
    jsonb_build_object('documentVersionId', target_version.id, 'loadId', target_document.load_id),
    concat('document-check:', target_version.id)
  ) on conflict (idempotency_key) do nothing;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'document.uploaded', 'document',
    target_document.id,
    jsonb_build_object('versionId', target_version.id, 'provider', 'cloudinary')
  );
  return target_document;
end;
$$;

create or replace function public.complete_document_upload(
  version_id uuid,
  checksum_sha256 text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_version public.document_versions;
  result public.documents;
begin
  select * into target_version
  from public.document_versions
  where id = version_id and company_id = actor.company_id
  for update;
  if target_version.id is null or target_version.uploaded_by <> actor.id then
    raise exception 'Upload not found';
  end if;
  if target_version.upload_expires_at is not null
     and target_version.upload_expires_at <= now() then
    raise exception 'Upload session expired';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'load-documents' and o.name = target_version.storage_path
  ) then raise exception 'File upload is incomplete'; end if;

  update public.document_versions
  set checksum_sha256 = complete_document_upload.checksum_sha256,
      upload_expires_at = null,
      upload_lease_started_at = null
  where id = target_version.id;
  update public.document_versions
  set superseded_at = now()
  where document_id = target_version.document_id
    and id <> target_version.id
    and superseded_at is null;
  update public.documents
  set current_version_id = target_version.id
  where id = target_version.document_id
  returning * into result;
  insert into public.document_checks(company_id, document_version_id)
  values (actor.company_id, target_version.id)
  on conflict do nothing;
  insert into public.jobs(company_id, type, payload, idempotency_key)
  values (
    actor.company_id, 'document.ai_check',
    jsonb_build_object('documentVersionId', target_version.id, 'loadId', result.load_id),
    concat('document-check:', target_version.id)
  ) on conflict (idempotency_key) do nothing;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reassignment: keep the old assignment active until replacement acceptance
-- ---------------------------------------------------------------------------

create or replace function public.reassign_load(
  load_id uuid,
  new_driver_id uuid,
  origin_latitude numeric default null,
  origin_longitude numeric default null,
  estimated_deadhead_miles numeric default 0
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_load public.loads;
  current_assignment public.assignments;
  result public.offers;
  driver_is_online boolean := false;
  next_offer_status public.offer_status;
  warnings jsonb;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  select * into target_load
  from public.loads
  where id = load_id and company_id = actor.company_id
  for update;
  if target_load.id is null
     or target_load.status in ('delivered', 'completed', 'cancelled') then
    raise exception 'Load cannot be reassigned';
  end if;
  select * into current_assignment
  from public.assignments
  where id = target_load.current_assignment_id and status = 'active'
  for update;
  if current_assignment.id is null then
    raise exception 'Load has no active assignment to replace';
  end if;
  if current_assignment.driver_id = new_driver_id then
    raise exception 'Load is already assigned to this driver';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new_driver_id
      and p.company_id = actor.company_id
      and p.role = 'driver'
      and p.status = 'active'
  ) or not public.can_access_driver(new_driver_id) then
    raise exception 'Driver is not eligible';
  end if;

  -- Retire an abandoned offer from an older assignment generation. Without
  -- this, an obsolete pending row would be returned forever by idempotent
  -- retries after another handoff changed current_assignment_id.
  update public.offers o
  set status = 'superseded', responded_at = now()
  where o.load_id = target_load.id
    and o.driver_id = new_driver_id
    and o.status in ('pending', 'missed_offline')
    and o.compatibility_warnings @> jsonb_build_array(
      jsonb_build_object('code', 'REASSIGNMENT')
    )
    and not o.compatibility_warnings @> jsonb_build_array(
      jsonb_build_object(
        'code', 'REASSIGNMENT',
        'previousAssignmentId', current_assignment.id
      )
    );

  select * into result
  from public.offers o
  where o.load_id = target_load.id
    and o.driver_id = new_driver_id
    and o.status = 'pending'
    and o.compatibility_warnings @> jsonb_build_array(
      jsonb_build_object(
        'code', 'REASSIGNMENT',
        'previousAssignmentId', current_assignment.id
      )
    )
  order by o.created_at desc
  limit 1
  for update;
  if result.id is not null then return result; end if;

  select coalesce(p.is_online and p.last_seen_at >= now() - interval '2 minutes', false)
  into driver_is_online
  from public.driver_presence p
  where p.driver_id = new_driver_id and p.company_id = actor.company_id;
  driver_is_online := coalesce(driver_is_online, false);

  if not driver_is_online then
    select * into result
    from public.offers o
    where o.load_id = target_load.id
      and o.driver_id = new_driver_id
      and o.status = 'missed_offline'
      and o.compatibility_warnings @> jsonb_build_array(
        jsonb_build_object(
          'code', 'REASSIGNMENT',
          'previousAssignmentId', current_assignment.id
        )
      )
    order by o.created_at desc
    limit 1
    for update;
    if result.id is not null then return result; end if;
  end if;

  next_offer_status := case when driver_is_online then 'pending'::public.offer_status
                            else 'missed_offline'::public.offer_status end;
  warnings := jsonb_build_array(jsonb_build_object(
    'code', 'REASSIGNMENT',
    'message', 'Load reassignment requires driver acceptance',
    'previousAssignmentId', current_assignment.id
  ));

  insert into public.offers(
    company_id, load_id, driver_id, status, origin_latitude, origin_longitude,
    estimated_deadhead_miles, loaded_miles, effective_rpm,
    compatibility_warnings, delivered_at, created_by
  ) values (
    actor.company_id, target_load.id, new_driver_id, next_offer_status,
    origin_latitude, origin_longitude, greatest(estimated_deadhead_miles, 0),
    target_load.loaded_miles,
    case when target_load.loaded_miles + greatest(estimated_deadhead_miles, 0) > 0
      then target_load.broker_rate /
        (target_load.loaded_miles + greatest(estimated_deadhead_miles, 0))
      else 0 end,
    warnings, case when driver_is_online then now() else null end, actor.id
  ) returning * into result;

  if driver_is_online then
    insert into public.notifications(
      company_id, recipient_id, type, title, body, entity_type, entity_id
    ) values (
      actor.company_id, new_driver_id, 'load_reassignment',
      'Load reassignment', 'Accept this load to complete the reassignment.',
      'offer', result.id
    );
  end if;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id,
    case when driver_is_online then 'load.reassignment_offered'
         else 'load.reassignment_missed_offline' end,
    'load', target_load.id,
    jsonb_build_object(
      'offerId', result.id,
      'driverId', new_driver_id,
      'previousAssignmentId', current_assignment.id
    )
  );
  return result;
end;
$$;

drop function if exists public.respond_offer(uuid, text, uuid, timestamptz);
create or replace function public.respond_offer(
  offer_id uuid,
  response text,
  operation_id uuid,
  occurred_at timestamptz default now(),
  decline_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  offer_hint public.offers;
  target_offer public.offers;
  target_load public.loads;
  old_assignment public.assignments;
  new_assignment public.assignments;
  latest_snapshot_id uuid;
  response_payload jsonb;
  reassignment_marker jsonb;
  expected_assignment_id uuid;
  previous_operation_actor uuid;
  is_reassignment boolean := false;
  next_driver_stage text := 'accepted';
  normalized_decline_reason text := nullif(left(btrim(decline_reason), 500), '');
begin
  if actor.id is null or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;

  -- Serialize retries before inspecting operation state. This makes one
  -- operation_id durable even when two devices retry concurrently.
  perform pg_advisory_xact_lock(hashtextextended(operation_id::text, 0));
  select actor_id, result
  into previous_operation_actor, response_payload
  from public.client_operations
  where client_operations.operation_id = respond_offer.operation_id;
  if found then
    if previous_operation_actor <> actor.id then
      raise exception 'Operation id belongs to another actor';
    end if;
    return response_payload;
  end if;

  -- The first lookup is intentionally unlocked and is used only to discover
  -- the aggregate. Mutation always follows the global load -> assignment ->
  -- offer lock order shared with reassign_load.
  select * into offer_hint
  from public.offers
  where id = offer_id
    and driver_id = actor.id
    and company_id = actor.company_id;
  if offer_hint.id is null then
    raise exception 'Offer not found';
  end if;

  select * into target_load
  from public.loads
  where id = offer_hint.load_id and company_id = actor.company_id
  for update;
  if target_load.id is null then raise exception 'Load not found'; end if;

  if target_load.current_assignment_id is not null then
    select * into old_assignment
    from public.assignments
    where id = target_load.current_assignment_id
    for update;
  end if;

  select * into target_offer
  from public.offers
  where id = offer_hint.id
    and driver_id = actor.id
    and company_id = actor.company_id
  for update;
  if target_offer.id is null then raise exception 'Offer not found'; end if;

  if target_offer.status <> 'pending' then
    -- This branch performs no mutation, so the legacy exception contract is
    -- safe. Branches that newly supersede an offer return a durable structured
    -- result below instead of raising and rolling their update back.
    raise exception 'Offer is no longer available';
  end if;

  if lower(response) = 'decline' then
    update public.offers set status = 'declined', responded_at = now()
    where id = target_offer.id;
    response_payload := jsonb_strip_nulls(jsonb_build_object(
      'offerId', target_offer.id,
      'status', 'declined',
      'reason', normalized_decline_reason
    ));
    insert into public.client_operations(
      operation_id, company_id, actor_id, load_id, command_type, base_version,
      payload, occurred_at, received_at, status, result, error_message
    ) values (
      operation_id, actor.company_id, actor.id, target_load.id,
      'respond_offer', target_load.version,
      jsonb_strip_nulls(jsonb_build_object(
        'response', 'decline', 'reason', normalized_decline_reason
      )), occurred_at, now(),
      'accepted', response_payload, null
    );
    insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
    values (actor.company_id, actor.id, 'offer.declined', 'offer', target_offer.id, response_payload);
    return response_payload;
  end if;
  if lower(response) <> 'accept' then
    raise exception 'Response must be accept or decline';
  end if;

  select item into reassignment_marker
  from jsonb_array_elements(target_offer.compatibility_warnings) item
  where item->>'code' = 'REASSIGNMENT'
  limit 1;
  is_reassignment := reassignment_marker is not null;

  if is_reassignment then
    begin
      expected_assignment_id := nullif(reassignment_marker->>'previousAssignmentId', '')::uuid;
    exception when invalid_text_representation then
      expected_assignment_id := null;
    end;
    if expected_assignment_id is null
       or target_load.current_assignment_id is distinct from expected_assignment_id then
      update public.offers set status = 'superseded', responded_at = now()
      where id = target_offer.id;
      response_payload := jsonb_build_object(
        'offerId', target_offer.id,
        'loadId', target_load.id,
        'status', 'superseded',
        'reassignment', true,
        'reason', 'active_assignment_changed'
      );
      insert into public.client_operations(
        operation_id, company_id, actor_id, load_id, command_type, base_version,
        payload, occurred_at, received_at, status, result, error_message
      ) values (
        operation_id, actor.company_id, actor.id, target_load.id,
        'respond_offer', target_load.version,
        jsonb_build_object('response', 'accept'), occurred_at, now(),
        'rejected', response_payload, 'The active assignment changed before acceptance'
      );
      return response_payload;
    end if;
    if old_assignment.id is distinct from expected_assignment_id
       or old_assignment.status <> 'active'
       or old_assignment.driver_id = actor.id then
      update public.offers set status = 'superseded', responded_at = now()
      where id = target_offer.id;
      response_payload := jsonb_build_object(
        'offerId', target_offer.id,
        'loadId', target_load.id,
        'status', 'superseded',
        'reassignment', true,
        'reason', 'reassignment_unavailable'
      );
      insert into public.client_operations(
        operation_id, company_id, actor_id, load_id, command_type, base_version,
        payload, occurred_at, received_at, status, result, error_message
      ) values (
        operation_id, actor.company_id, actor.id, target_load.id,
        'respond_offer', target_load.version,
        jsonb_build_object('response', 'accept'), occurred_at, now(),
        'rejected', response_payload, 'Reassignment is no longer available'
      );
      return response_payload;
    end if;
    next_driver_stage := old_assignment.driver_stage;
  elsif target_load.status not in ('offered', 'ready_for_offer')
        or target_load.current_assignment_id is not null then
    update public.offers set status = 'superseded', responded_at = now()
    where id = target_offer.id;
    response_payload := jsonb_build_object(
      'offerId', target_offer.id,
      'loadId', target_load.id,
      'status', 'superseded',
      'reassignment', false,
      'reason', 'load_already_assigned'
    );
    insert into public.client_operations(
      operation_id, company_id, actor_id, load_id, command_type, base_version,
      payload, occurred_at, received_at, status, result, error_message
    ) values (
      operation_id, actor.company_id, actor.id, target_load.id,
      'respond_offer', target_load.version,
      jsonb_build_object('response', 'accept'), occurred_at, now(),
      'rejected', response_payload, 'Load was assigned to another driver'
    );
    return response_payload;
  end if;

  select id into latest_snapshot_id
  from public.load_price_snapshots
  where load_price_snapshots.load_id = target_load.id
  order by created_at desc, id desc
  limit 1;

  if is_reassignment then
    update public.assignments
    set status = 'reassigned', ended_at = now()
    where id = old_assignment.id and status = 'active';
  end if;

  insert into public.assignments(
    company_id, load_id, driver_id, offer_id, assigned_by, accepted_at,
    accepted_price_snapshot_id, requires_reconfirmation, reconfirmed_at,
    driver_stage
  ) values (
    actor.company_id, target_load.id, actor.id, target_offer.id,
    target_offer.created_by, now(), latest_snapshot_id, false, now(),
    next_driver_stage
  ) returning * into new_assignment;

  update public.offers set status = 'accepted', responded_at = now()
  where id = target_offer.id;
  update public.offers set status = 'superseded', responded_at = now()
  where load_id = target_load.id
    and id <> target_offer.id
    and status = 'pending';
  update public.loads
  set status = case when is_reassignment then target_load.status
                    else 'assigned'::public.load_status end,
      current_assignment_id = new_assignment.id,
      version = version + 1
  where id = target_load.id;

  response_payload := jsonb_build_object(
    'offerId', target_offer.id,
    'loadId', target_load.id,
    'assignmentId', new_assignment.id,
    'status', 'accepted',
    'reassignment', is_reassignment
  );
  insert into public.client_operations(
    operation_id, company_id, actor_id, load_id, command_type, base_version,
    payload, occurred_at, received_at, status, result, error_message
  ) values (
    operation_id, actor.company_id, actor.id, target_load.id,
    'respond_offer', target_load.version,
    jsonb_build_object('response', 'accept'), occurred_at, now(),
    'accepted', response_payload, null
  );
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id,
    case when is_reassignment then 'load.reassigned' else 'offer.accepted' end,
    case when is_reassignment then 'load' else 'offer' end,
    case when is_reassignment then target_load.id else target_offer.id end,
    response_payload
  );
  return response_payload;
end;
$$;

revoke all on function public.respond_offer(uuid, text, uuid, timestamptz, text)
from public, anon;
grant execute on function public.respond_offer(uuid, text, uuid, timestamptz, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Least-privilege driver profile and dispatcher mapping reads
-- ---------------------------------------------------------------------------

drop policy if exists driver_profiles_company_read on public.driver_profiles;
drop policy if exists driver_profiles_scoped_read on public.driver_profiles;
create policy driver_profiles_scoped_read on public.driver_profiles
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.current_app_role() = 'super_admin'
  or (
    company_id = public.current_company_id()
    and public.current_app_role() in ('company_admin', 'dispatcher')
    and public.can_access_driver(user_id)
  )
);

drop policy if exists dispatcher_driver_access_company_read
on public.dispatcher_driver_access;
drop policy if exists dispatcher_driver_access_scoped_read
on public.dispatcher_driver_access;
create policy dispatcher_driver_access_scoped_read
on public.dispatcher_driver_access
for select to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (
    company_id = public.current_company_id()
    and (
      public.current_app_role() = 'company_admin'
      or dispatcher_id = (select auth.uid())
      or driver_id = (select auth.uid())
    )
  )
);

-- Add warnings once even when the migration is replayed against a database
-- where another environment already published it.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'warnings'
  ) then
    alter publication supabase_realtime add table public.warnings;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'driver_profiles'
  ) then
    alter publication supabase_realtime add table public.driver_profiles;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Distributed Edge Function rate-limit counter. Only trusted service-role
-- callers can consume a bucket; browser/mobile users cannot inspect counters.
-- ---------------------------------------------------------------------------

create table if not exists public.edge_rate_limits (
  scope text not null,
  actor text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, actor),
  check (length(scope) between 1 and 100),
  check (length(actor) between 1 and 500)
);

create index if not exists edge_rate_limits_retention_idx
  on public.edge_rate_limits (updated_at);

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.edge_rate_limits to service_role;

create or replace function public.consume_edge_rate_limit(
  scope text,
  actor text,
  limit_count integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_scope text := trim(scope);
  normalized_actor text := trim(actor);
  current_window timestamptz;
  consumed_count integer;
begin
  if length(normalized_scope) not between 1 and 100
     or length(normalized_actor) not between 1 and 500 then
    raise exception 'Rate-limit scope and actor are required';
  end if;
  if limit_count not between 1 and 100000
     or window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate-limit configuration';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds
  );

  insert into public.edge_rate_limits(
    scope, actor, window_started_at, request_count, updated_at
  ) values (
    normalized_scope, normalized_actor, current_window, 1, now()
  )
  on conflict on constraint edge_rate_limits_pkey do update set
    window_started_at = case
      when edge_rate_limits.window_started_at < excluded.window_started_at
        then excluded.window_started_at
      else edge_rate_limits.window_started_at
    end,
    request_count = case
      when edge_rate_limits.window_started_at < excluded.window_started_at then 1
      else least(edge_rate_limits.request_count + 1, limit_count + 1)
    end,
    updated_at = now()
  returning edge_rate_limits.request_count into consumed_count;

  return consumed_count <= limit_count;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, text, integer, integer)
to service_role;

create or replace function public.cleanup_edge_rate_limits(
  retain_for interval default interval '2 days',
  batch_size integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_rows integer;
begin
  if retain_for is null
     or retain_for < interval '1 minute'
     or retain_for > interval '30 days' then
    raise exception 'Retention must be between 1 minute and 30 days';
  end if;
  if coalesce(batch_size, 0) < 1 or batch_size > 10000 then
    raise exception 'Batch size must be between 1 and 10000';
  end if;

  with expired as (
    select r.scope, r.actor
    from public.edge_rate_limits r
    where r.updated_at < clock_timestamp() - retain_for
    order by r.updated_at, r.scope, r.actor
    limit batch_size
    for update skip locked
  )
  delete from public.edge_rate_limits r
  using expired e
  where r.scope = e.scope and r.actor = e.actor;

  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

revoke all on function public.cleanup_edge_rate_limits(interval, integer)
from public, anon, authenticated;
grant execute on function public.cleanup_edge_rate_limits(interval, integer)
to service_role;

-- ---------------------------------------------------------------------------
-- Push delivery foundation. A separate trusted worker/Edge Function claims
-- durable push_deliveries rows and calls FCM/APNs; no credentials live here.
-- ---------------------------------------------------------------------------

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  token text not null check (length(token) between 20 and 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint push_devices_user_fk
    foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint push_devices_user_company_fk
    foreign key (user_id, company_id) references public.profiles(id, company_id),
  constraint push_devices_user_platform_token_key
    unique (user_id, company_id, platform, token),
  constraint push_devices_token_key unique (token)
);

alter table public.push_devices
  add column if not exists disabled_at timestamptz;

alter table public.push_devices enable row level security;

drop policy if exists push_devices_own_read on public.push_devices;
create policy push_devices_own_read on public.push_devices
for select to authenticated
using (
  user_id = (select auth.uid())
  and company_id = public.current_company_id()
  and disabled_at is null
);

revoke all on public.push_devices from public, anon, authenticated;
grant select on public.push_devices to authenticated;

create table if not exists public.push_deliveries (
  notification_id uuid not null
    references public.notifications(id) on delete cascade,
  device_id uuid not null
    references public.push_devices(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  token_snapshot text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 32),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, device_id)
);

create index if not exists push_deliveries_claim_idx
  on public.push_deliveries (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');
create index if not exists push_deliveries_stale_processing_idx
  on public.push_deliveries (locked_at)
  where status = 'processing';

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.push_deliveries to service_role;

create or replace function public.register_push_device(
  token text,
  platform text
)
returns public.push_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  existing public.push_devices;
  saved public.push_devices;
  active_device_count integer;
begin
  if actor.id is null or actor.status <> 'active' or actor.company_id is null then
    raise exception 'Active company profile required';
  end if;
  if lower(trim(platform)) not in ('android', 'ios', 'web') then
    raise exception 'Unsupported push platform';
  end if;
  if length(trim(token)) not between 20 and 4096 then
    raise exception 'Invalid push token';
  end if;

  -- One consistent lock order handles same-token account switches and
  -- concurrent registrations of different tokens for the same user.
  perform pg_advisory_xact_lock(
    hashtextextended(concat('push-token:', trim(token)), 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(concat('push-user:', actor.id), 0)
  );

  select * into existing
  from public.push_devices d
  where d.token = trim(register_push_device.token)
  for update;

  select count(*) into active_device_count
  from public.push_devices d
  where d.user_id = actor.id
    and d.company_id = actor.company_id
    and d.disabled_at is null
    and d.token <> trim(register_push_device.token);
  if active_device_count >= 10 then
    raise exception 'A maximum of 10 active push devices is allowed per user';
  end if;

  if existing.id is not null
     and (
       existing.user_id <> actor.id
       or existing.company_id <> actor.company_id
     ) then
    update public.push_deliveries pd
    set status = 'cancelled',
        last_error = 'Push token ownership changed',
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where pd.device_id = existing.id
      and pd.status in ('pending', 'processing', 'failed');
  end if;

  insert into public.push_devices(user_id, company_id, platform, token)
  values (
    actor.id, actor.company_id, lower(trim(platform)), trim(token)
  )
  on conflict on constraint push_devices_token_key do update set
    user_id = excluded.user_id,
    company_id = excluded.company_id,
    platform = excluded.platform,
    disabled_at = null,
    updated_at = now(),
    last_seen_at = now()
  returning * into saved;

  if saved.user_id <> actor.id or saved.company_id <> actor.company_id then
    raise exception 'Push token ownership transfer failed';
  end if;
  return saved;
end;
$$;

create or replace function public.unregister_push_device(token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  device_was_disabled boolean := false;
begin
  if actor.id is null then raise exception 'Authentication required'; end if;
  update public.push_devices d
  set disabled_at = now(), updated_at = now()
  where d.token = trim(unregister_push_device.token)
    and d.user_id = actor.id
    and d.company_id = actor.company_id
    and d.disabled_at is null;
  device_was_disabled := found;
  if device_was_disabled then
    update public.push_deliveries pd
    set status = 'cancelled',
        last_error = 'Push device was unregistered',
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where pd.device_id = (
      select d.id from public.push_devices d
      where d.token = trim(unregister_push_device.token)
    )
      and pd.status in ('pending', 'processing', 'failed');
  end if;
  return device_was_disabled;
end;
$$;

revoke all on function public.register_push_device(text, text)
from public, anon;
grant execute on function public.register_push_device(text, text)
to authenticated;
revoke all on function public.unregister_push_device(text)
from public, anon;
grant execute on function public.unregister_push_device(text)
to authenticated;

create or replace function public.claim_push_deliveries(
  worker_id text,
  batch_size integer default 100
)
returns table (
  notification_id uuid,
  device_id uuid,
  company_id uuid,
  recipient_id uuid,
  platform text,
  push_token text,
  title text,
  body text,
  notification_type text,
  entity_type text,
  entity_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(worker_id), '') is null then
    raise exception 'Worker id is required';
  end if;
  if coalesce(batch_size, 0) < 1 or batch_size > 500 then
    raise exception 'Batch size must be between 1 and 500';
  end if;

  update public.push_deliveries pd
  set status = 'cancelled',
      last_error = 'Push delivery worker lease expired after maximum attempts',
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where pd.status = 'processing'
    and pd.locked_at < clock_timestamp() - interval '5 minutes'
    and pd.attempt_count >= pd.max_attempts;

  return query
  with candidates as (
    select pd.notification_id, pd.device_id
    from public.push_deliveries pd
    join public.push_devices d on d.id = pd.device_id
    where (
        (pd.status in ('pending', 'failed')
          and pd.next_attempt_at <= clock_timestamp())
        or (pd.status = 'processing'
          and pd.locked_at < clock_timestamp() - interval '5 minutes')
      )
      and pd.attempt_count < pd.max_attempts
      and d.disabled_at is null
      and d.user_id = pd.recipient_id
      and d.company_id = pd.company_id
      and d.token = pd.token_snapshot
    order by pd.device_id, pd.next_attempt_at, pd.created_at,
      pd.notification_id
    limit batch_size
    for update of d, pd skip locked
  ), claimed as (
    update public.push_deliveries pd
    set status = 'processing',
        attempt_count = pd.attempt_count + 1,
        locked_at = now(),
        locked_by = btrim(worker_id),
        updated_at = now()
    from candidates c
    where pd.notification_id = c.notification_id
      and pd.device_id = c.device_id
    returning pd.*
  )
  select
    c.notification_id,
    c.device_id,
    c.company_id,
    c.recipient_id,
    c.platform,
    c.token_snapshot,
    n.title,
    n.body,
    n.type,
    n.entity_type,
    n.entity_id,
    c.attempt_count
  from claimed c
  join public.notifications n on n.id = c.notification_id;
end;
$$;

create or replace function public.complete_push_delivery(
  notification_id uuid,
  device_id uuid,
  worker_id text,
  provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_deliveries pd
  set status = 'sent',
      provider_message_id = nullif(btrim(complete_push_delivery.provider_message_id), ''),
      last_error = null,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where pd.notification_id = complete_push_delivery.notification_id
    and pd.device_id = complete_push_delivery.device_id
    and pd.status = 'processing'
    and pd.locked_by = btrim(complete_push_delivery.worker_id);
  return found;
end;
$$;

drop function if exists public.fail_push_delivery(uuid, uuid, text, text, interval);
create or replace function public.fail_push_delivery(
  notification_id uuid,
  device_id uuid,
  worker_id text,
  error_message text,
  retry_after interval default interval '1 minute',
  retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if retry_after is null
     or retry_after < interval '1 second'
     or retry_after > interval '1 day' then
    raise exception 'Retry delay must be between 1 second and 1 day';
  end if;

  update public.push_deliveries pd
  set status = case when not fail_push_delivery.retryable
          or pd.attempt_count >= pd.max_attempts
        then 'cancelled' else 'failed' end,
      next_attempt_at = case when not fail_push_delivery.retryable
          or pd.attempt_count >= pd.max_attempts
        then pd.next_attempt_at else now() + retry_after end,
      last_error = left(coalesce(error_message, 'Unknown push provider error'), 2000),
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where pd.notification_id = fail_push_delivery.notification_id
    and pd.device_id = fail_push_delivery.device_id
    and pd.status = 'processing'
    and pd.locked_by = btrim(fail_push_delivery.worker_id);
  return found;
end;
$$;

revoke all on function public.claim_push_deliveries(text, integer)
from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(text, integer)
to service_role;
revoke all on function public.complete_push_delivery(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.complete_push_delivery(uuid, uuid, text, text)
to service_role;
revoke all on function public.fail_push_delivery(uuid, uuid, text, text, interval, boolean)
from public, anon, authenticated;
grant execute on function public.fail_push_delivery(uuid, uuid, text, text, interval, boolean)
to service_role;

create or replace function public.dead_letter_job(
  job_id uuid,
  worker_id text,
  error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs j
  set status = 'dead_letter',
      locked_at = null,
      locked_by = null,
      last_error = left(coalesce(error_message, 'Permanent worker error'), 4000),
      updated_at = now()
  where j.id = dead_letter_job.job_id
    and j.status = 'processing'
    and j.locked_by = btrim(dead_letter_job.worker_id);
  return found;
end;
$$;

revoke all on function public.dead_letter_job(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.dead_letter_job(uuid, text, text)
to service_role;

create or replace function public.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_deliveries(
    notification_id, device_id, company_id, recipient_id, platform,
    token_snapshot
  )
  select
    new.id, d.id, new.company_id, new.recipient_id, d.platform, d.token
  from public.push_devices d
  where d.user_id = new.recipient_id
    and d.company_id = new.company_id
    and d.disabled_at is null
  on conflict (notification_id, device_id) do nothing;

  return new;
end;
$$;

drop trigger if exists notifications_enqueue_push on public.notifications;
create trigger notifications_enqueue_push
after insert on public.notifications
for each row execute function public.enqueue_push_notification();

comment on table public.push_devices is
  'User-owned FCM/APNs/Web Push registration metadata. Provider delivery is performed by a trusted worker.';
comment on table public.push_deliveries is
  'Durable per-notification/device push fanout with unique delivery identity and retry state.';
comment on function public.cleanup_expired_document_uploads(integer) is
  'Service worker cleanup for expired, unbound document upload leases.';
comment on function public.register_push_device(text, text) is
  'Registers or refreshes the authenticated user push token without exposing direct table writes.';
comment on function public.consume_edge_rate_limit(text, text, integer, integer) is
  'Atomically consumes a fixed-window Edge Function quota. Service role only.';
comment on function public.cleanup_edge_rate_limits(interval, integer) is
  'Deletes expired distributed rate-limit buckets in bounded service-role batches.';

revoke all on function public.stop_has_required_document(uuid)
from public, anon, authenticated;
