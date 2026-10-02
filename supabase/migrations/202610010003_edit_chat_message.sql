alter table public.chat_messages
  add column if not exists edited_at timestamptz;

create or replace function public.edit_chat_message(
  target_message_id uuid,
  new_body text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.chat_messages;
  cleaned_body text := btrim(coalesce(new_body, ''));
begin
  if actor.id is null or actor.status <> 'active' then
    raise exception 'Active authentication required';
  end if;
  if cleaned_body = '' or char_length(cleaned_body) > 4000 then
    raise exception 'Message must contain 1 to 4000 characters';
  end if;

  select m.* into target
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  where m.id = target_message_id
    and m.company_id = actor.company_id
    and c.company_id = actor.company_id
    and m.sender_id = actor.id
    and actor.id in (c.dispatcher_id, c.driver_id)
    and m.kind = 'text'
    and m.deleted_at is null
  for update of m;

  if target.id is null then
    raise exception 'Only the sender can edit an active text message';
  end if;

  update public.chat_messages m
  set body = cleaned_body,
      edited_at = now()
  where m.id = target.id
  returning m.* into target;

  return target;
end;
$$;

revoke all on function public.edit_chat_message(uuid, text) from public, anon;
grant execute on function public.edit_chat_message(uuid, text) to authenticated;
