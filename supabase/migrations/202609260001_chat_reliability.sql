-- Reliable chat history pagination and recoverable WebRTC call leases.

alter table public.chat_calls
  add column if not exists last_heartbeat_at timestamptz not null default now();

create index if not exists chat_calls_active_heartbeat_idx
  on public.chat_calls (conversation_id, last_heartbeat_at)
  where status in ('ringing', 'accepted');

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
  select * into saved from public.chat_calls c
  where c.id = call_id and actor_id in (c.initiator_id, c.recipient_id)
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
  update public.chat_calls c
  set last_heartbeat_at = now()
  where c.id = target_call_id
    and actor_id in (c.initiator_id, c.recipient_id)
    and c.status in ('ringing', 'accepted')
  returning * into saved;
  if saved.id is null then raise exception 'Active call not found'; end if;
  return saved;
end;
$$;

revoke all on function public.get_chat_messages_page(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.start_chat_call(uuid, public.chat_call_kind) from public, anon;
revoke all on function public.respond_chat_call(uuid, text) from public, anon;
revoke all on function public.heartbeat_chat_call(uuid) from public, anon;

grant execute on function public.get_chat_messages_page(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.start_chat_call(uuid, public.chat_call_kind) to authenticated;
grant execute on function public.respond_chat_call(uuid, text) to authenticated;
grant execute on function public.heartbeat_chat_call(uuid) to authenticated;
