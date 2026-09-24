-- A participant may remove only a message they sent. The row is soft-deleted
-- for auditability; clients remove the associated private Storage object.
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

revoke all on function public.delete_chat_message(uuid) from public, anon;
grant execute on function public.delete_chat_message(uuid) to authenticated;

create policy storage_chat_media_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'chat-media'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and exists (
    select 1 from public.chat_conversations c
    where c.id::text = (storage.foldername(name))[2]
      and (c.dispatcher_id = (select auth.uid()) or c.driver_id = (select auth.uid()))
  )
);
