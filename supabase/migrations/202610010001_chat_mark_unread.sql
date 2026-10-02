-- Let a chat participant intentionally return the latest incoming message to unread.
create or replace function public.mark_chat_unread(target_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  target_message_id uuid;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then
    raise exception 'Chat access denied';
  end if;

  select m.id into target_message_id
  from public.chat_messages m
  where m.conversation_id = target_conversation_id
    and m.sender_id <> actor_id
    and m.deleted_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if target_message_id is null then return null; end if;

  update public.chat_messages
  set read_at = null
  where id = target_message_id;

  return target_message_id;
end;
$$;

revoke all on function public.mark_chat_unread(uuid) from public, anon;
grant execute on function public.mark_chat_unread(uuid) to authenticated;
