-- Private Cloudinary asset registry. Database references use cloudinary:<uuid>
-- so existing storage_path columns remain backwards compatible during migration.
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  scope text not null check (scope in (
    'chat', 'profile_avatar', 'driver_document', 'load_document',
    'broker_original', 'gmail_raw', 'manual_import'
  )),
  context_id uuid,
  cloudinary_asset_id text not null unique,
  public_id text not null,
  resource_type text not null check (resource_type in ('image', 'video', 'raw')),
  delivery_type text not null default 'authenticated' check (delivery_type = 'authenticated'),
  version bigint not null check (version > 0),
  format text,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (resource_type, delivery_type, public_id)
);

create index media_assets_company_created_idx
  on public.media_assets (company_id, created_at desc)
  where deleted_at is null;
create index media_assets_context_idx
  on public.media_assets (scope, context_id)
  where deleted_at is null;

alter table public.media_assets enable row level security;

create policy media_assets_select_company
on public.media_assets for select to authenticated
using (
  company_id = public.current_company_id()
  and deleted_at is null
  and case
    when scope = 'chat' then public.can_access_chat_conversation(context_id)
    when scope = 'load_document' then public.can_access_load(context_id)
    when scope in ('profile_avatar', 'driver_document') then
      context_id = (select auth.uid())
      or public.current_app_role() in ('company_admin', 'dispatcher', 'super_admin')
    else public.current_app_role() in ('company_admin', 'dispatcher', 'super_admin')
  end
);

create or replace function public.cloudinary_media_id(media_ref text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  if media_ref is null or media_ref !~ '^cloudinary:[0-9a-fA-F-]{36}$' then
    return null;
  end if;
  return substring(media_ref from 12)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.is_valid_cloudinary_media(
  media_ref text,
  expected_scope text default null,
  expected_context_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.media_assets m
    where m.id = public.cloudinary_media_id(media_ref)
      and m.company_id = public.current_company_id()
      and m.deleted_at is null
      and (expected_scope is null or m.scope = expected_scope)
      and (expected_context_id is null or m.context_id = expected_context_id)
  );
$$;

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

  select * into target_document
  from public.documents
  where id = target_version.document_id and public.can_access_load(load_id)
  for update;
  if target_document.id is null then raise exception 'Document access denied'; end if;
  if not public.is_valid_cloudinary_media(media_ref, 'load_document', target_document.load_id) then
    raise exception 'Cloudinary media was not found';
  end if;

  update public.document_versions
  set storage_path = media_ref,
      checksum_sha256 = bind_document_version_media.checksum_sha256
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
    actor.company_id,
    'document.ai_check',
    jsonb_build_object('documentVersionId', target_version.id, 'loadId', target_document.load_id),
    concat('document-check:', target_version.id)
  ) on conflict (idempotency_key) do nothing;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id,
    actor.id,
    'document.uploaded',
    'document',
    target_document.id,
    jsonb_build_object('versionId', target_version.id, 'provider', 'cloudinary')
  );
  return target_document;
end;
$$;

-- Accept private Cloudinary references in chat while retaining old Storage paths.
create or replace function public.send_chat_message(
  conversation_id uuid,
  message_kind public.chat_message_kind,
  message_body text default null,
  media_storage_path text default null,
  media_file_name text default null,
  media_mime_type text default null,
  media_size_bytes bigint default null,
  media_duration_ms integer default null,
  reply_to_message_id uuid default null,
  message_client_id uuid default gen_random_uuid()
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  conversation public.chat_conversations;
  saved public.chat_messages;
  recipient uuid;
begin
  select * into conversation
  from public.chat_conversations c
  where c.id = conversation_id
    and c.company_id = actor.company_id
    and actor.id in (c.dispatcher_id, c.driver_id);
  if conversation.id is null then raise exception 'Chat access denied'; end if;
  if message_kind = 'text' and nullif(btrim(coalesce(message_body, '')), '') is null then
    raise exception 'Message text is required';
  end if;
  if message_kind in ('image', 'video', 'audio', 'file') and media_storage_path is null then
    raise exception 'Media storage path is required';
  end if;
  if media_storage_path is not null
    and not public.is_valid_cloudinary_media(media_storage_path, 'chat', conversation.id)
    and media_storage_path not like actor.company_id::text || '/' || conversation.id::text || '/%'
  then raise exception 'Invalid media reference'; end if;

  insert into public.chat_messages(
    company_id, conversation_id, sender_id, kind, body, storage_path,
    file_name, mime_type, size_bytes, duration_ms, reply_to_id, client_id
  ) values (
    actor.company_id, conversation.id, actor.id, message_kind,
    nullif(btrim(coalesce(message_body, '')), ''), media_storage_path,
    media_file_name, media_mime_type, media_size_bytes, media_duration_ms,
    reply_to_message_id, message_client_id
  )
  on conflict (sender_id, client_id) do update set client_id = excluded.client_id
  returning * into saved;
  update public.chat_conversations
  set last_message_at = saved.created_at, updated_at = now()
  where id = conversation.id;
  recipient := case when actor.id = conversation.driver_id
    then conversation.dispatcher_id else conversation.driver_id end;
  insert into public.notifications(company_id, recipient_id, type, title, body, entity_type, entity_id)
  values (
    actor.company_id, recipient, 'chat_message', actor.full_name,
    case when message_kind = 'text' then left(saved.body, 180) else 'New ' || message_kind::text || ' message' end,
    'chat_conversation', conversation.id
  );
  return saved;
end;
$$;

-- Switch profile media validation from bucket-only to dual provider support.
create or replace function public.set_my_profile_media(media_kind text, object_path text)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor public.profiles := public.current_profile();
  expected_prefix text;
begin
  if actor.id is null then raise exception 'Authenticated profile required'; end if;
  if actor.company_id is null then raise exception 'Company membership required'; end if;
  if media_kind not in ('avatar', 'driver_license') then raise exception 'Unsupported profile media type'; end if;
  expected_prefix := actor.company_id::text || '/' || actor.id::text || '/';
  if not public.is_valid_cloudinary_media(
      object_path,
      case when media_kind = 'avatar' then 'profile_avatar' else 'driver_document' end,
      actor.id
    ) and (
      object_path is null
      or object_path not like expected_prefix || '%'
      or not exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = object_path)
    )
  then raise exception 'Uploaded profile media was not found'; end if;
  if media_kind = 'avatar' then
    update public.profiles set avatar_path = object_path, updated_at = now() where id = actor.id;
  else
    if actor.role <> 'driver' then raise exception 'Driver permission required'; end if;
    update public.driver_profiles set cdl_document_path = object_path, updated_at = now() where user_id = actor.id;
  end if;
end;
$$;

create or replace function public.save_my_driver_document(
  p_document_type text,
  p_file_name text,
  p_mime_type text,
  p_storage_path text,
  p_size_bytes bigint
)
returns public.driver_documents
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor public.profiles := public.current_profile();
  expected_prefix text;
  result public.driver_documents;
begin
  if actor.id is null or actor.role <> 'driver' then raise exception 'Driver permission required'; end if;
  if p_document_type not in ('registration','ifta','medical_certificate','insurance','other') then
    raise exception 'Unsupported driver document type';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp') then
    raise exception 'Only image documents are supported';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'Document image must be between 1 byte and 10 MB';
  end if;
  expected_prefix := actor.company_id::text || '/' || actor.id::text || '/documents/';
  if not public.is_valid_cloudinary_media(p_storage_path, 'driver_document', actor.id)
    and (
      p_storage_path is null
      or p_storage_path not like expected_prefix || '%'
      or not exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_storage_path)
    )
  then raise exception 'Uploaded driver document was not found'; end if;
  insert into public.driver_documents(
    company_id, driver_id, document_type, file_name, mime_type, storage_path, size_bytes
  ) values (
    actor.company_id, actor.id, p_document_type, trim(p_file_name), p_mime_type, p_storage_path, p_size_bytes
  ) returning * into result;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id, actor.id, 'driver.document_uploaded', 'driver_document', result.id,
    jsonb_build_object('documentType', result.document_type, 'provider',
      case when p_storage_path like 'cloudinary:%' then 'cloudinary' else 'supabase' end)
  );
  return result;
end;
$$;

revoke all on table public.media_assets from public, anon;
grant select on table public.media_assets to authenticated;
revoke all on function public.cloudinary_media_id(text) from public, anon;
revoke all on function public.is_valid_cloudinary_media(text, text, uuid) from public, anon;
revoke all on function public.bind_document_version_media(uuid, text, text) from public, anon;
grant execute on function public.cloudinary_media_id(text) to authenticated, service_role;
grant execute on function public.is_valid_cloudinary_media(text, text, uuid) to authenticated, service_role;
grant execute on function public.bind_document_version_media(uuid, text, text) to authenticated;
