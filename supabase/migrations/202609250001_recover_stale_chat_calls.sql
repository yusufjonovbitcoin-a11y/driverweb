-- Recover calls left active after a browser/app closes or media setup fails.
update public.chat_calls
set status = 'missed', ended_at = now()
where status = 'ringing'
  and started_at < now() - interval '90 seconds';

update public.chat_calls
set status = 'ended', ended_at = now()
where status = 'accepted'
  and coalesce(answered_at, started_at) < now() - interval '4 hours';

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
  set status = 'missed', ended_at = now()
  where c.conversation_id = conversation.id
    and c.status = 'ringing'
    and c.started_at < now() - interval '90 seconds';

  update public.chat_calls c
  set status = 'ended', ended_at = now()
  where c.conversation_id = conversation.id
    and c.status = 'accepted'
    and coalesce(c.answered_at, c.started_at) < now() - interval '4 hours';

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

revoke all on function public.start_chat_call(uuid, public.chat_call_kind) from public, anon;
grant execute on function public.start_chat_call(uuid, public.chat_call_kind) to authenticated;
