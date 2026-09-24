-- Realtime direct messaging and WebRTC call signaling for dispatcher-driver chat.
-- Client mutations stay behind named RPCs; media remains in a private bucket.

create type public.chat_message_kind as enum ('text', 'image', 'video', 'audio', 'file', 'system', 'call');
create type public.chat_call_kind as enum ('audio', 'video');
create type public.chat_call_status as enum ('ringing', 'accepted', 'declined', 'missed', 'ended');
create type public.chat_signal_kind as enum ('offer', 'answer', 'ice');

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dispatcher_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_conversation_distinct_members check (dispatcher_id <> driver_id),
  unique (dispatcher_id, driver_id)
);

create index chat_conversations_driver_idx
  on public.chat_conversations (driver_id, last_message_at desc);
create index chat_conversations_dispatcher_idx
  on public.chat_conversations (dispatcher_id, last_message_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind public.chat_message_kind not null default 'text',
  body text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  client_id uuid not null default gen_random_uuid(),
  read_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_message_content_required check (
    nullif(btrim(coalesce(body, '')), '') is not null or storage_path is not null
  ),
  unique (sender_id, client_id)
);

create index chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at desc);
create index chat_messages_unread_idx
  on public.chat_messages (conversation_id, sender_id, created_at)
  where read_at is null and deleted_at is null;

create table public.chat_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  initiator_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind public.chat_call_kind not null,
  status public.chat_call_status not null default 'ringing',
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_call_distinct_members check (initiator_id <> recipient_id)
);

create index chat_calls_recipient_idx
  on public.chat_calls (recipient_id, status, started_at desc);

create table public.chat_call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.chat_calls(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind public.chat_signal_kind not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint chat_signal_distinct_members check (sender_id <> recipient_id)
);

create index chat_call_signals_recipient_idx
  on public.chat_call_signals (recipient_id, call_id, id);

create or replace function public.can_access_chat_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_conversations c
    where c.id = target_conversation_id
      and c.company_id = public.current_company_id()
      and (c.dispatcher_id = (select auth.uid()) or c.driver_id = (select auth.uid()))
  );
$$;

create or replace function public.open_direct_chat(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.profiles;
  chat_id uuid;
  selected_dispatcher_id uuid;
  selected_driver_id uuid;
begin
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active authentication required';
  end if;

  select * into target
  from public.profiles p
  where p.id = target_user_id
    and p.company_id = actor.company_id
    and p.status = 'active';
  if target.id is null then raise exception 'Chat member not found'; end if;

  if actor.role = 'driver' and target.role in ('dispatcher', 'company_admin') then
    selected_driver_id := actor.id;
    selected_dispatcher_id := target.id;
  elsif actor.role in ('dispatcher', 'company_admin') and target.role = 'driver' then
    if actor.role = 'dispatcher' and not public.can_access_driver(target.id) then
      raise exception 'Driver access denied';
    end if;
    selected_driver_id := target.id;
    selected_dispatcher_id := actor.id;
  else
    raise exception 'Chat is available only between a driver and dispatcher';
  end if;

  insert into public.chat_conversations(company_id, dispatcher_id, driver_id)
  values (actor.company_id, selected_dispatcher_id, selected_driver_id)
  on conflict (dispatcher_id, driver_id) do update
    set updated_at = now()
  returning id into chat_id;

  return chat_id;
end;
$$;

create or replace function public.open_default_driver_chat()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_id uuid;
  existing_id uuid;
begin
  if actor.id is null or actor.role <> 'driver' or actor.status <> 'active' then
    raise exception 'Driver permission required';
  end if;

  select c.id into existing_id
  from public.chat_conversations c
  where c.driver_id = actor.id
  order by c.last_message_at desc
  limit 1;
  if existing_id is not null then return existing_id; end if;

  select p.id into target_id
  from public.profiles p
  where p.company_id = actor.company_id
    and p.status = 'active'
    and p.role in ('dispatcher', 'company_admin')
  order by
    case when exists (
      select 1 from public.dispatcher_driver_access a
      where a.dispatcher_id = p.id and a.driver_id = actor.id
    ) then 0 else 1 end,
    case p.role when 'dispatcher' then 0 else 1 end,
    p.created_at
  limit 1;

  if target_id is null then raise exception 'No dispatcher is available'; end if;
  return public.open_direct_chat(target_id);
end;
$$;

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
  if media_storage_path is not null and media_storage_path not like
      actor.company_id::text || '/' || conversation.id::text || '/%' then
    raise exception 'Invalid media storage path';
  end if;

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
    actor.company_id,
    recipient,
    'chat_message',
    actor.full_name,
    case when message_kind = 'text' then left(saved.body, 180) else 'New ' || message_kind::text || ' message' end,
    'chat_conversation',
    conversation.id
  );

  return saved;
end;
$$;

create or replace function public.mark_chat_read(conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  if not public.can_access_chat_conversation(conversation_id) then
    raise exception 'Chat access denied';
  end if;
  update public.chat_messages m
  set read_at = now()
  where m.conversation_id = mark_chat_read.conversation_id
    and m.sender_id <> (select auth.uid())
    and m.read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.get_unread_chat_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  where (c.dispatcher_id = (select auth.uid()) or c.driver_id = (select auth.uid()))
    and m.sender_id <> (select auth.uid())
    and m.read_at is null
    and m.deleted_at is null;
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
  select * into conversation
  from public.chat_conversations c
  where c.id = conversation_id
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
  select * into conversation
  from public.chat_conversations c
  where c.id = conversation_id
    and c.company_id = actor.company_id
    and actor.id in (c.dispatcher_id, c.driver_id);
  if conversation.id is null then raise exception 'Chat access denied'; end if;
  recipient := case when actor.id = conversation.driver_id
    then conversation.dispatcher_id else conversation.driver_id end;

  update public.chat_calls
  set status = 'missed', ended_at = now()
  where conversation_id = conversation.id and status = 'ringing'
    and started_at < now() - interval '90 seconds';

  if exists (
    select 1 from public.chat_calls c
    where c.conversation_id = conversation.id and c.status in ('ringing', 'accepted')
  ) then raise exception 'A call is already active'; end if;

  insert into public.chat_calls(company_id, conversation_id, initiator_id, recipient_id, kind)
  values (actor.company_id, conversation.id, actor.id, recipient, call_kind)
  returning * into saved;
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
  select * into saved from public.chat_calls c
  where c.id = call_id and actor_id in (c.initiator_id, c.recipient_id)
  for update;
  if saved.id is null then raise exception 'Call access denied'; end if;

  if action = 'accepted' and actor_id = saved.recipient_id and saved.status = 'ringing' then
    update public.chat_calls set status = 'accepted', answered_at = now()
    where id = saved.id returning * into saved;
  elsif action = 'declined' and actor_id = saved.recipient_id and saved.status = 'ringing' then
    update public.chat_calls set status = 'declined', ended_at = now()
    where id = saved.id returning * into saved;
  elsif action = 'ended' and saved.status in ('ringing', 'accepted') then
    update public.chat_calls set status = 'ended', ended_at = now()
    where id = saved.id returning * into saved;
  else
    raise exception 'Invalid call transition';
  end if;
  return saved;
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
  select * into target from public.chat_calls c
  where c.id = call_id
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

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_calls enable row level security;
alter table public.chat_call_signals enable row level security;

create policy chat_conversations_participant_read on public.chat_conversations
for select to authenticated using (
  company_id = public.current_company_id()
  and (dispatcher_id = (select auth.uid()) or driver_id = (select auth.uid()))
);
create policy chat_messages_participant_read on public.chat_messages
for select to authenticated using (public.can_access_chat_conversation(conversation_id));
create policy chat_calls_participant_read on public.chat_calls
for select to authenticated using (
  initiator_id = (select auth.uid()) or recipient_id = (select auth.uid())
);
create policy chat_signals_recipient_read on public.chat_call_signals
for select to authenticated using (
  sender_id = (select auth.uid()) or recipient_id = (select auth.uid())
);

grant select on public.chat_conversations, public.chat_messages, public.chat_calls, public.chat_call_signals to authenticated;
grant usage, select on sequence public.chat_call_signals_id_seq to authenticated;

revoke all on function public.can_access_chat_conversation(uuid) from public, anon;
revoke all on function public.open_direct_chat(uuid) from public, anon;
revoke all on function public.open_default_driver_chat() from public, anon;
revoke all on function public.send_chat_message(uuid, public.chat_message_kind, text, text, text, text, bigint, integer, uuid, uuid) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.get_unread_chat_count() from public, anon;
revoke all on function public.get_chat_context(uuid) from public, anon;
revoke all on function public.start_chat_call(uuid, public.chat_call_kind) from public, anon;
revoke all on function public.respond_chat_call(uuid, text) from public, anon;
revoke all on function public.publish_chat_signal(uuid, public.chat_signal_kind, jsonb) from public, anon;

grant execute on function public.can_access_chat_conversation(uuid) to authenticated;
grant execute on function public.open_direct_chat(uuid) to authenticated;
grant execute on function public.open_default_driver_chat() to authenticated;
grant execute on function public.send_chat_message(uuid, public.chat_message_kind, text, text, text, text, bigint, integer, uuid, uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.get_unread_chat_count() to authenticated;
grant execute on function public.get_chat_context(uuid) to authenticated;
grant execute on function public.start_chat_call(uuid, public.chat_call_kind) to authenticated;
grant execute on function public.respond_chat_call(uuid, text) to authenticated;
grant execute on function public.publish_chat_signal(uuid, public.chat_signal_kind, jsonb) to authenticated;

alter publication supabase_realtime add table public.chat_conversations;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_calls;
alter publication supabase_realtime add table public.chat_call_signals;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime',
        'audio/aac', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/ogg', 'audio/webm',
        'application/pdf', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy storage_chat_media_read on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and exists (
    select 1 from public.chat_conversations c
    where c.id::text = (storage.foldername(name))[2]
      and (c.dispatcher_id = (select auth.uid()) or c.driver_id = (select auth.uid()))
  )
);

create policy storage_chat_media_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and exists (
    select 1 from public.chat_conversations c
    where c.id::text = (storage.foldername(name))[2]
      and (c.dispatcher_id = (select auth.uid()) or c.driver_id = (select auth.uid()))
  )
);
