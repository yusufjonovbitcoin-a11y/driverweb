-- Additive chat consistency APIs. This migration does not redact or delete
-- existing message/notification/media content. New deletion behavior is used
-- only by a later explicit delete_chat_message request from the sender.
alter table public.notifications add column chat_message_id uuid references public.chat_messages(id) on delete set null;
create index notifications_chat_message_idx on public.notifications(chat_message_id) where chat_message_id is not null;
create index chat_messages_live_storage_idx on public.chat_messages(storage_path) where storage_path is not null and deleted_at is null;

-- A tombstone retains synchronization identity, not deleted content.
alter table public.chat_messages drop constraint chat_message_content_required;
alter table public.chat_messages add constraint chat_message_content_required check (
  deleted_at is not null or nullif(btrim(coalesce(body,'')),'') is not null or storage_path is not null
);

-- Retain revoked keys even after an object is removed: an uploader must not be
-- able to recreate that path and obtain a new URL for a deleted attachment.
create table public.chat_media_revocations (
  storage_path text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  revoked_at timestamptz not null default now()
);
alter table public.chat_media_revocations enable row level security;
revoke all on public.chat_media_revocations from public, anon, authenticated;
grant all on public.chat_media_revocations to service_role;
create index chat_media_revocations_company_idx on public.chat_media_revocations(company_id);

create function public.can_upload_chat_media(target_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select (select auth.uid()) is not null and length(target_path) <= 1024
    and split_part(target_path,'/',1)=public.current_company_id()::text
    and target_path !~ '(^|/)(\.{1,2})?(/|$)'
    and array_length(string_to_array(target_path,'/'),1)>=3
    and not exists(select 1 from public.chat_media_revocations r where r.storage_path=target_path)
    and exists(select 1 from public.chat_conversations c where c.id::text=split_part(target_path,'/',2)
      and c.company_id=public.current_company_id() and (select auth.uid()) in(c.dispatcher_id,c.driver_id));
$$;
create function public.can_read_chat_media(target_path text, object_owner_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_upload_chat_media(target_path) and (
    object_owner_id=(select auth.uid())::text or exists(
      select 1 from public.chat_messages m where m.storage_path=target_path and m.deleted_at is null
        and public.can_access_chat_conversation(m.conversation_id)
    )
  );
$$;
revoke all on function public.can_upload_chat_media(text),public.can_read_chat_media(text,text) from public,anon;
grant execute on function public.can_upload_chat_media(text),public.can_read_chat_media(text,text) to authenticated;
alter policy storage_chat_media_read on storage.objects
using(bucket_id='chat-media' and public.can_read_chat_media(name,owner_id));
alter policy storage_chat_media_upload on storage.objects
with check(bucket_id='chat-media' and owner_id=(select auth.uid())::text and public.can_upload_chat_media(name));
alter policy storage_chat_media_delete_own on storage.objects
using(bucket_id='chat-media' and owner_id=(select auth.uid())::text and public.can_upload_chat_media(name)
  and not exists(select 1 from public.chat_messages m where m.storage_path=name and m.deleted_at is null));
update storage.buckets set public=false,file_size_limit=52428800 where id='chat-media';

create or replace function public.send_chat_message(
  conversation_id uuid, message_kind public.chat_message_kind, message_body text default null,
  media_storage_path text default null, media_file_name text default null, media_mime_type text default null,
  media_size_bytes bigint default null, media_duration_ms integer default null,
  reply_to_message_id uuid default null, message_client_id uuid default gen_random_uuid()
) returns public.chat_messages language plpgsql security definer set search_path=public as $$
declare actor public.profiles := public.current_profile(); conversation public.chat_conversations;
  saved public.chat_messages; recipient uuid;
begin
  if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
  select * into conversation from public.chat_conversations c where c.id=send_chat_message.conversation_id
    and c.company_id=actor.company_id and actor.id in(c.dispatcher_id,c.driver_id);
  if conversation.id is null then raise exception 'Chat access denied'; end if;
  if message_client_id is null then raise exception 'Message client ID is required'; end if;
  -- Same lock as the existing rate-limit trigger; retries return their original
  -- result before checking a now-deleted reply/media reference.
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text,4217));
  select m.* into saved from public.chat_messages m where m.sender_id=actor.id and m.client_id=message_client_id;
  if saved.id is not null then
    if saved.conversation_id is distinct from conversation.id then raise exception 'Message client ID belongs to another conversation'; end if;
    return saved;
  end if;
  if message_kind is null or message_kind not in('text','image','video','audio','file') then raise exception 'Unsupported message kind'; end if;
  if reply_to_message_id is not null and not exists(select 1 from public.chat_messages m where m.id=reply_to_message_id
    and m.conversation_id=conversation.id and m.deleted_at is null) then raise exception 'Reply message not found in this conversation'; end if;
  if message_kind='text' and nullif(btrim(coalesce(message_body,'')),'') is null then raise exception 'Message text is required'; end if;
  if message_kind in('image','video','audio','file') and media_storage_path is null then raise exception 'Media storage path is required'; end if;
  if media_storage_path is not null then
    perform pg_advisory_xact_lock(hashtextextended('chat-media:'||media_storage_path,4343));
    if media_storage_path like 'cloudinary:%' then
      if not exists(select 1 from public.media_assets a where a.id=public.cloudinary_media_id(media_storage_path)
        and a.company_id=actor.company_id and a.scope='chat' and a.context_id=conversation.id
        and a.uploaded_by=actor.id and a.deleted_at is null) then raise exception 'Invalid media reference'; end if;
    elsif not public.can_upload_chat_media(media_storage_path) or split_part(media_storage_path,'/',2)<>conversation.id::text
      or not exists(select 1 from storage.objects o where o.bucket_id='chat-media' and o.name=media_storage_path
        and o.owner_id=actor.id::text) then raise exception 'Invalid media reference';
    end if;
    if exists(select 1 from public.chat_messages m where m.storage_path=media_storage_path and m.deleted_at is null) then
      raise exception 'Media reference already attached';
    end if;
  end if;
  insert into public.chat_messages(company_id,conversation_id,sender_id,kind,body,storage_path,file_name,mime_type,size_bytes,duration_ms,reply_to_id,client_id)
    values(actor.company_id,conversation.id,actor.id,message_kind,nullif(btrim(coalesce(message_body,'')),''),media_storage_path,
      media_file_name,media_mime_type,media_size_bytes,media_duration_ms,reply_to_message_id,message_client_id) returning * into saved;
  update public.chat_conversations set last_message_at=greatest(last_message_at,saved.created_at),updated_at=now() where id=conversation.id;
  recipient := case when actor.id=conversation.driver_id then conversation.dispatcher_id else conversation.driver_id end;
  insert into public.notifications(company_id,recipient_id,type,title,body,entity_type,entity_id,chat_message_id)
    values(actor.company_id,recipient,'chat_message',actor.full_name,
      case when message_kind='text' then left(saved.body,180) else 'New '||message_kind::text||' message' end,
      'chat_conversation',conversation.id,saved.id);
  return saved;
end $$;

create or replace function public.edit_chat_message(target_message_id uuid,new_body text)
returns public.chat_messages language plpgsql security definer set search_path=public as $$
declare actor public.profiles := public.current_profile(); target public.chat_messages;
  cleaned_body text := btrim(coalesce(new_body,''));
begin
  if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
  if cleaned_body='' or char_length(cleaned_body)>4000 then raise exception 'Message must contain 1 to 4000 characters'; end if;
  select m.* into target from public.chat_messages m join public.chat_conversations c on c.id=m.conversation_id
    where m.id=target_message_id and m.company_id=actor.company_id and c.company_id=actor.company_id
      and m.sender_id=actor.id and actor.id in(c.dispatcher_id,c.driver_id) and m.kind='text' and m.deleted_at is null for update of m;
  if target.id is null then raise exception 'Only the sender can edit an active text message'; end if;
  update public.chat_messages set body=cleaned_body,edited_at=now() where id=target.id returning * into target;
  -- Pending delivery reads this fresh linked notification; previously delivered
  -- device notifications cannot be recalled by a database change.
  update public.notifications set body=left(cleaned_body,180) where chat_message_id=target.id and type='chat_message';
  return target;
end $$;
revoke all on function public.edit_chat_message(uuid,text) from public,anon;
grant execute on function public.edit_chat_message(uuid,text) to authenticated;

create or replace function public.delete_chat_message(target_message_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare actor public.profiles := public.current_profile(); target public.chat_messages;
  media public.media_assets; cleanup_payload jsonb;
begin
  if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
  select m.* into target from public.chat_messages m join public.chat_conversations c on c.id=m.conversation_id
    where m.id=target_message_id and m.company_id=actor.company_id and m.sender_id=actor.id
      and c.company_id=actor.company_id and actor.id in(c.dispatcher_id,c.driver_id) for update of m;
  if target.id is null then raise exception 'Only the sender can delete this message'; end if;
  -- A retry is successful but must not enqueue duplicate work or change version.
  if target.deleted_at is not null then return null; end if;
  if target.storage_path is not null then
    perform pg_advisory_xact_lock(hashtextextended('chat-media:'||target.storage_path,4343));
    -- Legacy rows could share references; do not remove another live message's
    -- file. New sends prevent attachment reuse and require uploader ownership.
    if not exists(select 1 from public.chat_messages m where m.storage_path=target.storage_path
      and m.id<>target.id and m.deleted_at is null) then
      if target.storage_path like 'cloudinary:%' then
        select * into media from public.media_assets a where a.id=public.cloudinary_media_id(target.storage_path)
          and a.company_id=actor.company_id and a.scope='chat' and a.context_id=target.conversation_id
          and a.uploaded_by=actor.id for update;
        if media.id is not null then
          update public.media_assets set deleted_at=coalesce(deleted_at,now()) where id=media.id;
          cleanup_payload := jsonb_build_object('messageId',target.id,'provider','cloudinary','mediaRef',target.storage_path,
            'mediaAssetId',media.id,'assetId',media.cloudinary_asset_id,'publicId',media.public_id,
            'resourceType',media.resource_type,'deliveryType',media.delivery_type);
        end if;
      elsif target.storage_path like actor.company_id::text||'/'||target.conversation_id::text||'/%'
        and not exists(select 1 from storage.objects o where o.bucket_id='chat-media' and o.name=target.storage_path
          and o.owner_id is distinct from actor.id::text) then
        insert into public.chat_media_revocations(storage_path,company_id) values(target.storage_path,actor.company_id) on conflict do nothing;
        cleanup_payload := jsonb_build_object('messageId',target.id,'provider','supabase_storage','bucket','chat-media','storagePath',target.storage_path);
      end if;
      if cleanup_payload is not null then
        insert into public.jobs(company_id,type,payload,idempotency_key)
          values(actor.company_id,'provider.media_delete',cleanup_payload,'chat-media-delete:'||target.id) on conflict(idempotency_key) do nothing;
      end if;
    end if;
  end if;
  update public.chat_messages set deleted_at=now(),body=null,storage_path=null,file_name=null,mime_type=null,
    size_bytes=null,duration_ms=null,reply_to_id=null where id=target.id;
  update public.notifications set title='',body='',type='chat_message_deleted',read_at=coalesce(read_at,now())
    where chat_message_id=target.id;
  update public.push_deliveries d set status='cancelled',locked_at=null,locked_by=null,last_error='Chat message deleted',updated_at=now()
    where d.notification_id in(select n.id from public.notifications n where n.chat_message_id=target.id)
      and d.status in('pending','processing','failed');
  update public.chat_conversations c set last_message_at=coalesce((select max(m.created_at) from public.chat_messages m
    where m.conversation_id=target.conversation_id and m.deleted_at is null),c.created_at),updated_at=now() where c.id=target.conversation_id;
  -- The server owns durable cleanup. Older clients treat NULL as no local work.
  return null;
end $$;
revoke all on function public.send_chat_message(uuid,public.chat_message_kind,text,text,text,text,bigint,integer,uuid,uuid),public.delete_chat_message(uuid) from public,anon;
grant execute on function public.send_chat_message(uuid,public.chat_message_kind,text,text,text,text,bigint,integer,uuid,uuid),public.delete_chat_message(uuid) to authenticated;

alter table public.chat_messages add column revision bigint not null default 1 check (revision > 0);
create function public.stamp_chat_message_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
  return new;
end $$;
revoke all on function public.stamp_chat_message_revision() from public, anon, authenticated;
create trigger chat_message_revision before insert or update on public.chat_messages
for each row execute function public.stamp_chat_message_revision();

create table public.chat_read_preferences (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  marked_unread_at timestamptz default now(),
  unique (conversation_id, user_id)
);
create index chat_read_preferences_user_idx on public.chat_read_preferences(user_id, conversation_id);
alter table public.chat_read_preferences enable row level security;
revoke all on public.chat_read_preferences from public, anon, authenticated;
grant select on public.chat_read_preferences to authenticated;
grant all on public.chat_read_preferences to service_role;
create policy chat_read_preferences_own_read on public.chat_read_preferences for select to authenticated
using (user_id = (select auth.uid()) and public.can_access_chat_conversation(conversation_id));
alter publication supabase_realtime add table public.chat_read_preferences;

create or replace function public.mark_chat_unread(target_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_message_id uuid;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  select m.id into target_message_id from public.chat_messages m where m.conversation_id = target_conversation_id
    and m.sender_id <> (select auth.uid()) and m.deleted_at is null order by m.created_at desc, m.id desc limit 1;
  if target_message_id is null then return null; end if;
  insert into public.chat_read_preferences(conversation_id,user_id) values(target_conversation_id,(select auth.uid()))
    on conflict(conversation_id,user_id) do update set marked_unread_at = now();
  return target_message_id;
end $$;

create function public.clear_chat_unread(target_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  -- UPDATE remains RLS-authorized for Realtime; DELETE events cannot apply RLS
  -- to a removed row. Keep a private cleared row instead of emitting a delete.
  update public.chat_read_preferences set marked_unread_at=null
    where conversation_id=target_conversation_id and user_id=(select auth.uid()) and marked_unread_at is not null;
  return found;
end $$;
revoke all on function public.clear_chat_unread(uuid) from public, anon;
grant execute on function public.clear_chat_unread(uuid) to authenticated;

create or replace function public.mark_chat_messages_read(target_conversation_id uuid, message_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  if coalesce(cardinality(message_ids),0) > 100 then raise exception 'Read batch too large'; end if;
  update public.chat_messages m set read_at = now() where m.conversation_id = target_conversation_id
    and m.id = any(message_ids) and m.sender_id <> (select auth.uid()) and m.read_at is null and m.deleted_at is null;
  get diagnostics changed = row_count;
  if exists(select 1 from public.chat_messages m where m.conversation_id = target_conversation_id
    and m.id = any(message_ids) and m.sender_id <> (select auth.uid()) and m.deleted_at is null) then
    perform public.clear_chat_unread(target_conversation_id);
  end if;
  return changed;
end $$;

create or replace function public.mark_chat_read(target_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  update public.chat_messages m set read_at = now() where m.conversation_id = target_conversation_id
    and m.sender_id <> (select auth.uid()) and m.read_at is null and m.deleted_at is null;
  get diagnostics changed = row_count;
  perform public.clear_chat_unread(target_conversation_id);
  return changed;
end $$;

create or replace function public.get_chat_unread_summary()
returns table(driver_id uuid, unread_count bigint) language plpgsql stable security invoker set search_path = public as $$
begin
  if public.current_company_id() is null then raise exception 'Active authentication required'; end if;
  return query select case when c.driver_id = (select auth.uid()) then c.dispatcher_id else c.driver_id end,
    greatest(count(m.id), case when p.user_id is not null then 1::bigint else 0::bigint end)
    from public.chat_conversations c
    left join public.chat_messages m on m.conversation_id = c.id and m.sender_id <> (select auth.uid())
      and m.read_at is null and m.deleted_at is null
    left join public.chat_read_preferences p on p.conversation_id = c.id and p.user_id = (select auth.uid()) and p.marked_unread_at is not null
    group by c.id,c.driver_id,c.dispatcher_id,p.user_id
    having count(m.id)>0 or p.user_id is not null;
end $$;
create or replace function public.get_unread_chat_count()
returns bigint language sql stable security invoker set search_path = public as $$
  select coalesce(sum(unread_count),0)::bigint from public.get_chat_unread_summary();
$$;

-- Internal bounded expiry helper: only checked public wrappers are callable.
-- Existing accepted calls receive a fresh grace period at migration time.
alter table public.chat_calls
  add column initiator_heartbeat_at timestamptz not null default now(),
  add column recipient_heartbeat_at timestamptz not null default now();
create function public.expire_stale_chat_calls(target_user_id uuid, target_company_id uuid, batch_size integer)
returns integer language plpgsql security definer set search_path = public as $$
declare expired_ids uuid[];
begin
  if batch_size is null or batch_size < 1 or batch_size > 500 then raise exception 'Invalid recovery batch size'; end if;
  with candidates as (
    select c.id from public.chat_calls c
    where (target_user_id is null or (c.company_id = target_company_id and target_user_id in (c.initiator_id,c.recipient_id)))
      and ((c.status='ringing' and c.started_at < clock_timestamp()-interval '90 seconds')
        or (c.status='accepted' and least(c.initiator_heartbeat_at,c.recipient_heartbeat_at) < clock_timestamp()-interval '75 seconds'))
    order by c.id limit batch_size for update skip locked
  ), expired as (
    update public.chat_calls c set status = case when c.status='ringing' then 'missed'::public.chat_call_status else 'ended'::public.chat_call_status end,
      ended_at = now() from candidates x where c.id = x.id returning c.id
  ) select array_agg(id) into expired_ids from expired;
  delete from public.chat_call_signals where call_id = any(expired_ids);
  return coalesce(cardinality(expired_ids),0);
end $$;
revoke all on function public.expire_stale_chat_calls(uuid,uuid,integer) from public, anon, authenticated, service_role;

create function public.recover_stale_chat_calls()
returns integer language plpgsql security definer set search_path = public as $$
declare actor public.profiles := public.current_profile();
begin
  if actor.id is null then raise exception 'Active authentication required'; end if;
  return public.expire_stale_chat_calls(actor.id,actor.company_id,100);
end $$;
create function public.cleanup_stale_chat_calls(batch_size integer default 100)
returns integer language sql security definer set search_path = public as $$
  select public.expire_stale_chat_calls(null,null,batch_size);
$$;
create function public.get_incoming_chat_calls()
returns setof public.chat_calls language plpgsql security definer set search_path = public as $$
begin
  perform public.recover_stale_chat_calls();
  return query select c.* from public.chat_calls c where c.recipient_id = (select auth.uid())
    and c.company_id = public.current_company_id() and c.status='ringing'
    and c.started_at >= clock_timestamp()-interval '90 seconds' order by c.started_at desc limit 10;
end $$;
revoke all on function public.recover_stale_chat_calls() from public, anon;
grant execute on function public.recover_stale_chat_calls() to authenticated;
revoke all on function public.cleanup_stale_chat_calls(integer) from public, anon, authenticated;
grant execute on function public.cleanup_stale_chat_calls(integer) to service_role;
revoke all on function public.get_incoming_chat_calls() from public, anon;
grant execute on function public.get_incoming_chat_calls() to authenticated;

create index chat_calls_initiator_active_idx on public.chat_calls(initiator_id,status) where status in ('ringing','accepted');
create or replace function public.start_chat_call(conversation_id uuid, call_kind public.chat_call_kind)
returns public.chat_calls language plpgsql security definer set search_path = public as $$
declare actor public.profiles := public.current_profile(); conversation public.chat_conversations;
  recipient uuid; member_id uuid; saved public.chat_calls;
begin
  if actor.id is null then raise exception 'Active authentication required'; end if;
  select * into conversation from public.chat_conversations c where c.id=start_chat_call.conversation_id
    and c.company_id=actor.company_id and actor.id in(c.dispatcher_id,c.driver_id);
  if conversation.id is null then raise exception 'Chat access denied'; end if;
  recipient := case when actor.id=conversation.driver_id then conversation.dispatcher_id else conversation.driver_id end;
  if not exists(select 1 from public.profiles p where p.id=recipient and p.company_id=actor.company_id and p.status='active') then
    raise exception 'Chat member not available';
  end if;
  -- Stable participant lock order prevents cross-conversation double booking.
  for member_id in select x.id from unnest(array[actor.id,recipient]) x(id) order by x.id loop
    perform pg_advisory_xact_lock(hashtextextended(member_id::text,4341));
  end loop;
  perform public.expire_stale_chat_calls(actor.id,actor.company_id,100);
  perform public.expire_stale_chat_calls(recipient,actor.company_id,100);
  if exists(select 1 from public.chat_calls c where c.company_id=actor.company_id and c.status in('ringing','accepted')
    and (c.initiator_id in(actor.id,recipient) or c.recipient_id in(actor.id,recipient))) then
    raise exception 'CHAT_USER_BUSY';
  end if;
  insert into public.chat_calls(company_id,conversation_id,initiator_id,recipient_id,kind,last_heartbeat_at)
    values(actor.company_id,conversation.id,actor.id,recipient,call_kind,now()) returning * into saved;
  return saved;
end $$;

create index chat_call_signals_sender_time_idx on public.chat_call_signals(call_id,sender_id,created_at desc);
create or replace function public.heartbeat_chat_call(target_call_id uuid)
returns public.chat_calls language plpgsql security definer set search_path = public as $$
declare actor_id uuid := (select auth.uid()); saved public.chat_calls;
begin
  if public.current_company_id() is null then raise exception 'Active authentication required'; end if;
  update public.chat_calls c set last_heartbeat_at=now(),
    initiator_heartbeat_at=case when actor_id=c.initiator_id then now() else c.initiator_heartbeat_at end,
    recipient_heartbeat_at=case when actor_id=c.recipient_id then now() else c.recipient_heartbeat_at end
    where c.id=target_call_id
    and c.company_id=public.current_company_id() and actor_id in(c.initiator_id,c.recipient_id)
    and ((c.status='ringing' and c.started_at>=clock_timestamp()-interval '90 seconds')
      or (c.status='accepted' and least(c.initiator_heartbeat_at,c.recipient_heartbeat_at)>=clock_timestamp()-interval '75 seconds'))
    returning * into saved;
  if saved.id is null then raise exception 'Active call not found'; end if;
  return saved;
end $$;

create or replace function public.respond_chat_call(call_id uuid, action text)
returns public.chat_calls language plpgsql security definer set search_path = public as $$
declare actor_id uuid := (select auth.uid()); saved public.chat_calls;
begin
  if public.current_company_id() is null then raise exception 'Active authentication required'; end if;
  select * into saved from public.chat_calls c where c.id=respond_chat_call.call_id
    and c.company_id=public.current_company_id() and actor_id in(c.initiator_id,c.recipient_id) for update;
  if saved.id is null then raise exception 'Call access denied'; end if;
  if saved.status::text=action and (action='ended' or actor_id=saved.recipient_id) then return saved; end if;
  if action='accepted' and actor_id=saved.recipient_id and saved.status='ringing'
    and saved.started_at>=clock_timestamp()-interval '90 seconds' then
    update public.chat_calls set status='accepted',answered_at=now(),last_heartbeat_at=now(),
      initiator_heartbeat_at=now(),recipient_heartbeat_at=now() where id=saved.id returning * into saved;
  elsif action='declined' and actor_id=saved.recipient_id and saved.status='ringing' then
    update public.chat_calls set status='declined',ended_at=now() where id=saved.id returning * into saved;
  elsif action='ended' and saved.status in('ringing','accepted') then
    update public.chat_calls set status='ended',ended_at=now() where id=saved.id returning * into saved;
  elsif action='ended' and saved.status in('declined','missed','ended') then
    return saved;
  else raise exception 'Invalid call transition';
  end if;
  if saved.status in('declined','missed','ended') then delete from public.chat_call_signals where chat_call_signals.call_id=saved.id; end if;
  return saved;
end $$;

create or replace function public.publish_chat_signal(call_id uuid, signal_kind public.chat_signal_kind, signal_payload jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare actor_id uuid := (select auth.uid()); target public.chat_calls; recipient uuid; signal_id bigint;
begin
  if public.current_company_id() is null then raise exception 'Active authentication required'; end if;
  if signal_kind is null or signal_payload is null or jsonb_typeof(signal_payload)<>'object'
    or octet_length(signal_payload::text) > (case when signal_kind='ice' then 8192 else 65536 end) then
    raise exception 'CHAT_SIGNAL_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(call_id::text || ':' || actor_id::text,4342));
  select * into target from public.chat_calls c where c.id=publish_chat_signal.call_id
    and c.company_id=public.current_company_id() and actor_id in(c.initiator_id,c.recipient_id)
    and ((c.status='ringing' and c.started_at >= clock_timestamp()-interval '90 seconds')
      or (c.status='accepted' and least(c.initiator_heartbeat_at,c.recipient_heartbeat_at) >= clock_timestamp()-interval '75 seconds')) for update;
  if target.id is null then raise exception 'Active call not found'; end if;
  if (select count(*) from public.chat_call_signals s where s.call_id=target.id and s.sender_id=actor_id
    and s.created_at > clock_timestamp()-interval '1 minute') >= 120 then raise exception 'CHAT_SIGNAL_RATE_LIMIT'; end if;
  recipient := case when actor_id=target.initiator_id then target.recipient_id else target.initiator_id end;
  insert into public.chat_call_signals(call_id,company_id,sender_id,recipient_id,kind,payload)
    values(target.id,target.company_id,actor_id,recipient,signal_kind,signal_payload) returning id into signal_id;
  return signal_id;
end $$;

revoke all on function public.mark_chat_unread(uuid), public.mark_chat_read(uuid),
  public.mark_chat_messages_read(uuid,uuid[]), public.get_chat_unread_summary(), public.get_unread_chat_count(),
  public.start_chat_call(uuid,public.chat_call_kind), public.heartbeat_chat_call(uuid),
  public.respond_chat_call(uuid,text), public.publish_chat_signal(uuid,public.chat_signal_kind,jsonb) from public, anon;
grant execute on function public.mark_chat_unread(uuid), public.mark_chat_read(uuid),
  public.mark_chat_messages_read(uuid,uuid[]), public.get_chat_unread_summary(), public.get_unread_chat_count(),
  public.start_chat_call(uuid,public.chat_call_kind), public.heartbeat_chat_call(uuid),
  public.respond_chat_call(uuid,text), public.publish_chat_signal(uuid,public.chat_signal_kind,jsonb) to authenticated;
