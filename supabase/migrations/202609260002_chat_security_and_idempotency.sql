-- Chat mutations must preserve tenant, active-account and retry boundaries.

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
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active authentication required';
  end if;
  select * into conversation
  from public.chat_conversations c
  where c.id = send_chat_message.conversation_id
    and c.company_id = actor.company_id
    and actor.id in (c.dispatcher_id, c.driver_id);
  if conversation.id is null then raise exception 'Chat access denied'; end if;
  if message_kind is null or message_kind not in ('text', 'image', 'video', 'audio', 'file') then
    raise exception 'Unsupported message kind';
  end if;
  if message_client_id is null then raise exception 'Message client ID is required'; end if;
  if reply_to_message_id is not null and not exists (
    select 1 from public.chat_messages m
    where m.id = reply_to_message_id and m.conversation_id = conversation.id
      and m.deleted_at is null
  ) then raise exception 'Reply message not found in this conversation'; end if;

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
  on conflict (sender_id, client_id) do nothing
  returning * into saved;
  -- A retry must not bump ordering or send another notification. The unique
  -- sender/client key also serializes concurrent retries at the database.
  if saved.id is null then
    select m.* into saved from public.chat_messages m
    where m.sender_id = actor.id and m.client_id = message_client_id;
    if saved.conversation_id is distinct from conversation.id then
      raise exception 'Message client ID belongs to another conversation';
    end if;
    return saved;
  end if;
  update public.chat_conversations
  set last_message_at = greatest(last_message_at, saved.created_at), updated_at = now()
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

create or replace function public.get_chat_messages_page(
  target_conversation_id uuid,
  before_created_at timestamptz default null,
  before_message_id uuid default null,
  requested_page_size integer default 50
)
returns setof public.chat_messages
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
begin
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active authentication required';
  end if;
  if not exists (
    select 1
    from public.chat_conversations c
    where c.id = target_conversation_id
      and c.company_id = actor.company_id
      and actor.id in (c.dispatcher_id, c.driver_id)
  ) then
    raise exception 'Chat access denied';
  end if;

  return query
  select m.*
  from public.chat_messages m
  where m.conversation_id = target_conversation_id
    and m.deleted_at is null
    and (
      before_created_at is null
      or before_message_id is null
      or (m.created_at, m.id) < (before_created_at, before_message_id)
    )
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(requested_page_size, 50), 1), 100);
end;
$$;

create or replace function public.start_chat_call(
  conversation_id uuid,
  call_kind public.chat_call_kind
)
returns public.chat_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  conversation public.chat_conversations;
  saved public.chat_calls;
  recipient uuid;
begin
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active authentication required';
  end if;
  select * into conversation
  from public.chat_conversations c
  where c.id = start_chat_call.conversation_id
    and c.company_id = actor.company_id
    and actor.id in (c.dispatcher_id, c.driver_id)
  for update of c;
  if conversation.id is null then raise exception 'Chat access denied'; end if;

  recipient := case when actor.id = conversation.driver_id
    then conversation.dispatcher_id else conversation.driver_id end;

  update public.chat_calls c
  set status = 'missed', ended_at = now(), last_heartbeat_at = now()
  where c.conversation_id = conversation.id
    and c.status = 'ringing'
    and c.started_at < now() - interval '90 seconds';

  update public.chat_calls c
  set status = 'ended', ended_at = now(), last_heartbeat_at = now()
  where c.conversation_id = conversation.id
    and c.status = 'accepted'
    and c.last_heartbeat_at < now() - interval '75 seconds';

  delete from public.chat_call_signals s
  using public.chat_calls c
  where s.call_id = c.id
    and c.conversation_id = conversation.id
    and c.status in ('declined', 'missed', 'ended')
    and c.ended_at < now() - interval '5 minutes';

  if exists (
    select 1 from public.chat_calls c
    where c.conversation_id = conversation.id
      and c.status in ('ringing', 'accepted')
  ) then
    raise exception 'A call is already active';
  end if;

  insert into public.chat_calls(
    company_id, conversation_id, initiator_id, recipient_id, kind, last_heartbeat_at
  ) values (
    actor.company_id, conversation.id, actor.id, recipient, call_kind, now()
  ) returning * into saved;
  return saved;
end;
$$;

create or replace function public.respond_chat_call(call_id uuid, action text)
returns public.chat_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  saved public.chat_calls;
begin
  if public.current_company_id() is null then
    raise exception 'Active authentication required';
  end if;
  select * into saved from public.chat_calls c
  where c.id = respond_chat_call.call_id
    and c.company_id = public.current_company_id() and actor_id in (c.initiator_id, c.recipient_id)
  for update;
  if saved.id is null then raise exception 'Call access denied'; end if;

  if action = 'accepted' and actor_id = saved.recipient_id and saved.status = 'ringing' then
    update public.chat_calls
    set status = 'accepted', answered_at = now(), last_heartbeat_at = now()
    where id = saved.id returning * into saved;
  elsif action = 'declined' and actor_id = saved.recipient_id and saved.status = 'ringing' then
    update public.chat_calls
    set status = 'declined', ended_at = now(), last_heartbeat_at = now()
    where id = saved.id returning * into saved;
  elsif action = 'ended' and saved.status in ('ringing', 'accepted') then
    update public.chat_calls
    set status = 'ended', ended_at = now(), last_heartbeat_at = now()
    where id = saved.id returning * into saved;
  else
    raise exception 'Invalid call transition';
  end if;

  if saved.status in ('declined', 'missed', 'ended') then
    delete from public.chat_call_signals where chat_call_signals.call_id = saved.id;
  end if;
  return saved;
end;
$$;

create or replace function public.heartbeat_chat_call(target_call_id uuid)
returns public.chat_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  saved public.chat_calls;
begin
  if public.current_company_id() is null then
    raise exception 'Active authentication required';
  end if;
  update public.chat_calls c
  set last_heartbeat_at = now()
  where c.id = target_call_id
    and c.company_id = public.current_company_id()
    and actor_id in (c.initiator_id, c.recipient_id)
    and c.status in ('ringing', 'accepted')
  returning * into saved;
  if saved.id is null then raise exception 'Active call not found'; end if;
  return saved;
end;
$$;

create or replace function public.get_chat_context(conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  conversation public.chat_conversations;
  counterpart public.profiles;
begin
  if public.current_company_id() is null then
    raise exception 'Active authentication required';
  end if;
  select * into conversation
  from public.chat_conversations c
  where c.id = get_chat_context.conversation_id
    and c.company_id = public.current_company_id()
    and actor_id in (c.dispatcher_id, c.driver_id);
  if conversation.id is null then raise exception 'Chat access denied'; end if;
  select * into counterpart from public.profiles p
  where p.id = case when actor_id = conversation.driver_id
    then conversation.dispatcher_id else conversation.driver_id end;
  return jsonb_build_object(
    'conversationId', conversation.id,
    'companyId', conversation.company_id,
    'otherUserId', counterpart.id,
    'otherUserName', counterpart.full_name,
    'otherUserRole', counterpart.role
  );
end;
$$;

create or replace function public.publish_chat_signal(
  call_id uuid,
  signal_kind public.chat_signal_kind,
  signal_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  target public.chat_calls;
  recipient uuid;
  signal_id bigint;
begin
  if public.current_company_id() is null then
    raise exception 'Active authentication required';
  end if;
  select * into target from public.chat_calls c
  where c.id = publish_chat_signal.call_id
    and c.company_id = public.current_company_id()
    and actor_id in (c.initiator_id, c.recipient_id)
    and c.status in ('ringing', 'accepted');
  if target.id is null then raise exception 'Active call not found'; end if;
  recipient := case when actor_id = target.initiator_id then target.recipient_id else target.initiator_id end;
  insert into public.chat_call_signals(call_id, company_id, sender_id, recipient_id, kind, payload)
  values (target.id, target.company_id, actor_id, recipient, signal_kind, signal_payload)
  returning id into signal_id;
  return signal_id;
end;
$$;

create or replace function public.delete_chat_message(target_message_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.chat_messages;
begin
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active authentication required';
  end if;
  select m.* into target
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  where m.id = target_message_id
    and m.company_id = actor.company_id
    and m.sender_id = actor.id
    and actor.id in (c.dispatcher_id, c.driver_id)
  for update of m;

  if target.id is null then
    raise exception 'Only the sender can delete this message';
  end if;

  if target.deleted_at is null then
    update public.chat_messages m
    set deleted_at = now()
    where m.id = target.id;

    update public.chat_conversations c
    set last_message_at = coalesce(
          (
            select max(m.created_at)
            from public.chat_messages m
            where m.conversation_id = target.conversation_id
              and m.deleted_at is null
          ),
          c.created_at
        ),
        updated_at = now()
    where c.id = target.conversation_id;
  end if;

  return target.storage_path;
end;
$$;

-- Call rows and ICE/SDP signals must stop being readable when a profile is suspended.
alter policy chat_calls_participant_read on public.chat_calls
using (
  company_id = public.current_company_id()
  and (initiator_id = (select auth.uid()) or recipient_id = (select auth.uid()))
);
alter policy chat_signals_recipient_read on public.chat_call_signals
using (
  company_id = public.current_company_id()
  and (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
);
