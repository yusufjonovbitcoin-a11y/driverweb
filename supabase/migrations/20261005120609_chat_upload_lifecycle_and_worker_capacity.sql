-- Opt-in lifecycle for NEW web chat uploads. No historical object enumeration,
-- no deletion during migration, and no changes to load-document buckets.
create table public.chat_pending_uploads (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  company_id uuid not null references public.companies(id),
  conversation_id uuid not null references public.chat_conversations(id),
  uploaded_by uuid not null references public.profiles(id),
  state text not null default 'pending' check(state in ('pending','attached','cleanup')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 days'
);
alter table public.chat_pending_uploads enable row level security;
revoke all on public.chat_pending_uploads from public, anon, authenticated;
grant all on public.chat_pending_uploads to service_role;
create index chat_pending_uploads_expiry_idx on public.chat_pending_uploads(expires_at) where state='pending';
create index chat_pending_uploads_company_idx on public.chat_pending_uploads(company_id);
create index chat_pending_uploads_conversation_idx on public.chat_pending_uploads(conversation_id);
create index chat_pending_uploads_owner_idx on public.chat_pending_uploads(uploaded_by);

create function public.register_chat_media_upload(target_path text)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor public.profiles := public.current_profile(); upload public.chat_pending_uploads;
  conversation uuid;
begin
  if actor.id is null or actor.status <> 'active' then raise exception 'Active authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat-media:'||target_path,4343));
  if not public.can_upload_chat_media(target_path) then raise exception 'Invalid chat upload path'; end if;
  conversation := split_part(target_path,'/',2)::uuid;
  select * into upload from public.chat_pending_uploads where storage_path=target_path for update;
  if upload.id is not null then
    if upload.uploaded_by <> actor.id or upload.state='cleanup' then raise exception 'Chat upload unavailable'; end if;
    -- 8 days exceeds the client's 7-day retry retention. Renew BEFORE upload,
    -- under the same lock as the expiry claim and send_chat_message.
    if upload.state='pending' then
      update public.chat_pending_uploads set expires_at=clock_timestamp()+interval '8 days' where id=upload.id;
    end if;
    return upload.id;
  end if;
  -- Never adopt an old object, even when an old client's pending send retries.
  if exists(select 1 from storage.objects where bucket_id='chat-media' and name=target_path)
    or exists(select 1 from public.chat_messages where storage_path=target_path)
    or exists(select 1 from public.document_versions where storage_path=target_path) then return null; end if;
  insert into public.chat_pending_uploads(storage_path,company_id,conversation_id,uploaded_by)
    values(target_path,actor.company_id,conversation,actor.id) returning id into upload.id;
  return upload.id;
end $$;
revoke all on function public.register_chat_media_upload(text) from public,anon;
grant execute on function public.register_chat_media_upload(text) to authenticated;

-- Keep lifecycle + message commit atomic. A late/ambiguous response cannot make
-- a successfully attached file eligible for orphan cleanup. Legacy paths pass.
create function public.attach_registered_chat_upload()
returns trigger language plpgsql security definer set search_path=public as $$
declare upload public.chat_pending_uploads;
begin
  if new.storage_path is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat-media:'||new.storage_path,4343));
  select * into upload from public.chat_pending_uploads where storage_path=new.storage_path for update;
  if upload.id is null then return new; end if;
  if upload.state='cleanup' or upload.uploaded_by<>new.sender_id or upload.conversation_id<>new.conversation_id
    or upload.company_id<>new.company_id then raise exception 'Chat upload unavailable'; end if;
  update public.chat_pending_uploads set state='attached' where id=upload.id;
  return new;
end $$;
revoke all on function public.attach_registered_chat_upload() from public,anon,authenticated;
create trigger chat_attach_registered_upload before insert or update of storage_path on public.chat_messages
for each row execute function public.attach_registered_chat_upload();

create function public.queue_expired_chat_uploads(batch_size integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare candidate record; upload public.chat_pending_uploads; queued integer := 0;
begin
  if batch_size is null or batch_size<1 or batch_size>500 then raise exception 'Invalid cleanup batch size'; end if;
  for candidate in select id,storage_path from public.chat_pending_uploads
    where state='pending' and expires_at<clock_timestamp() order by expires_at,id limit batch_size loop
    -- Same lock order as registration and message commit, not row-then-advisory.
    if not pg_try_advisory_xact_lock(hashtextextended('chat-media:'||candidate.storage_path,4343)) then continue; end if;
    select * into upload from public.chat_pending_uploads where id=candidate.id for update;
    if upload.state<>'pending' or upload.expires_at>=clock_timestamp() then continue; end if;
    if exists(select 1 from public.chat_messages where storage_path=upload.storage_path)
      or exists(select 1 from public.document_versions where storage_path=upload.storage_path)
      or exists(select 1 from storage.objects where bucket_id='chat-media' and name=upload.storage_path
        and owner_id is distinct from upload.uploaded_by::text) then
      -- Conservative retention: do not guess ownership or delete referenced data.
      update public.chat_pending_uploads set state='attached' where id=upload.id;
      continue;
    end if;
    insert into public.chat_media_revocations(storage_path,company_id) values(upload.storage_path,upload.company_id)
      on conflict do nothing;
    update public.chat_pending_uploads set state='cleanup' where id=upload.id;
    insert into public.jobs(company_id,type,payload,idempotency_key)
      values(upload.company_id,'provider.media_delete',jsonb_build_object('provider','supabase_storage',
        'chatUploadId',upload.id,'bucket','chat-media','storagePath',upload.storage_path),
        'chat-upload-delete:'||upload.id) on conflict(idempotency_key) do nothing;
    queued := queued+1;
  end loop;
  return queued;
end $$;
revoke all on function public.queue_expired_chat_uploads(integer) from public,anon,authenticated;
grant execute on function public.queue_expired_chat_uploads(integer) to service_role;

-- Recheck each queued orphan immediately before Storage API deletion. This
-- function only authorizes a terminal, revoked, unreferenced registered path.
create function public.can_cleanup_chat_upload(target_upload_id uuid,target_company_id uuid,target_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.chat_pending_uploads u where u.id=target_upload_id
    and u.company_id=target_company_id and u.storage_path=target_path and u.state='cleanup'
    and exists(select 1 from public.chat_media_revocations r where r.storage_path=u.storage_path)
    and not exists(select 1 from public.chat_messages m where m.storage_path=u.storage_path)
    and not exists(select 1 from public.document_versions v where v.storage_path=u.storage_path)
    and not exists(select 1 from storage.objects o where o.bucket_id='chat-media' and o.name=u.storage_path
      and o.owner_id is distinct from u.uploaded_by::text));
$$;
revoke all on function public.can_cleanup_chat_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.can_cleanup_chat_upload(uuid,uuid,text) to service_role;

-- Raise per-invocation capacity without creating/enabling/rescheduling any job.
-- Push stays disabled until Firebase is configured and separately authorized.
do $$
declare definition text;
begin
  if to_regprocedure('worker_cron.invoke(text)') is not null then
    select pg_get_functiondef('worker_cron.invoke(text)'::regprocedure) into definition;
    if strpos(definition,'{"batchSize":3}')=0 then raise exception 'Unexpected Cron invocation definition'; end if;
    definition := replace(definition,'{"batchSize":3}','{"batchSize":30}');
    definition := replace(definition,'''expiredUploads'',''staleJobs'',''expiredRateLimits'',''staleCalls''',
      '''expiredUploads'',''staleJobs'',''expiredRateLimits'',''staleCalls'',''expiredChatUploads''');
    execute definition;
  end if;
end $$;
