-- Avoid a PL/pgSQL input-name collision with chat_messages.conversation_id.
drop function if exists public.mark_chat_read(uuid);

create function public.mark_chat_read(target_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then
    raise exception 'Chat access denied';
  end if;
  update public.chat_messages m
  set read_at = now()
  where m.conversation_id = target_conversation_id
    and m.sender_id <> (select auth.uid())
    and m.read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

