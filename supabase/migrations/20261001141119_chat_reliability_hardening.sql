-- Additive APIs: old mobile clients remain compatible. No message data is removed.
create index if not exists chat_messages_sender_created_idx
  on public.chat_messages(sender_id, created_at desc);
create index if not exists chat_messages_cursor_idx
  on public.chat_messages(conversation_id, created_at desc, id desc);
create index if not exists chat_messages_search_idx on public.chat_messages
  using gin(to_tsvector('simple', coalesce(body, '') || ' ' || coalesce(file_name, '')))
  where deleted_at is null;
create index if not exists chat_call_signals_call_id_idx on public.chat_call_signals(call_id, id);

create or replace function public.guard_chat_message_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('text', 'image', 'video', 'audio', 'file') then return new; end if;
  if length(coalesce(new.body, '')) > 4000 then
    raise exception 'CHAT_MESSAGE_TOO_LONG' using errcode = '22001';
  end if;
  if tg_op = 'INSERT' then
    -- Serialize per sender, including concurrent requests. Retries do not consume quota.
    perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text, 4217));
    if exists(select 1 from public.chat_messages where sender_id = new.sender_id and client_id = new.client_id) then
      return new;
    end if;
    if (select count(*) from public.chat_messages where sender_id = new.sender_id
        and created_at > clock_timestamp() - interval '1 minute') >= 60 then
      raise exception 'CHAT_RATE_LIMIT' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_chat_message_write() from public, anon, authenticated;
create trigger chat_message_write_guard before insert or update of body on public.chat_messages
  for each row execute function public.guard_chat_message_write();

-- Sync includes soft-delete tombstones so disconnected clients can remove stale rows.
create or replace function public.get_chat_sync_page(
  target_conversation_id uuid, before_created_at timestamptz default null,
  before_message_id uuid default null, requested_page_size integer default 100
) returns setof public.chat_messages language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  return query select m.* from public.chat_messages m
    where m.conversation_id = target_conversation_id
      and (before_created_at is null or (m.created_at, m.id) < (before_created_at, before_message_id))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(requested_page_size, 100), 1), 100);
end $$;

create or replace function public.get_chat_unread_summary()
returns table(driver_id uuid, unread_count bigint)
language sql stable security invoker set search_path = public as $$
  select case when c.driver_id = (select auth.uid()) then c.dispatcher_id else c.driver_id end,
    count(m.id)
  from public.chat_conversations c
  join public.chat_messages m on m.conversation_id = c.id
    and m.sender_id <> (select auth.uid()) and m.read_at is null and m.deleted_at is null
  group by 1;
$$;

-- Only mark the actually displayed IDs; never unseen history or a later arrival.
create or replace function public.mark_chat_messages_read(target_conversation_id uuid, message_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  if coalesce(cardinality(message_ids), 0) > 100 then raise exception 'Read batch too large'; end if;
  update public.chat_messages m set read_at = now()
    where m.conversation_id = target_conversation_id and m.id = any(message_ids)
      and m.sender_id <> (select auth.uid()) and m.read_at is null and m.deleted_at is null;
  get diagnostics changed = row_count;
  return changed;
end $$;

create or replace function public.search_chat_messages(
  target_conversation_id uuid, search_text text default '', media_kind text default 'all',
  before_created_at timestamptz default null, before_message_id uuid default null
) returns setof public.chat_messages language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  if length(search_text) > 200 then raise exception 'Search too long'; end if;
  return query select m.* from public.chat_messages m
    where m.conversation_id = target_conversation_id and m.deleted_at is null
      and (before_created_at is null or (m.created_at, m.id) < (before_created_at, before_message_id))
      and (media_kind = 'all' or m.kind::text = media_kind or (media_kind = 'links' and m.body ~* 'https?://'))
      and (btrim(search_text) = '' or to_tsvector('simple', coalesce(m.body, '') || ' ' || coalesce(m.file_name, ''))
        @@ plainto_tsquery('simple', search_text))
    order by m.created_at desc, m.id desc limit 50;
end $$;

create or replace function public.get_chat_media_counts(target_conversation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare result jsonb;
begin
  if not public.can_access_chat_conversation(target_conversation_id) then raise exception 'Chat access denied'; end if;
  select jsonb_build_object(
    'image', count(*) filter(where kind = 'image'), 'video', count(*) filter(where kind = 'video'),
    'audio', count(*) filter(where kind = 'audio'), 'file', count(*) filter(where kind = 'file'),
    'links', count(*) filter(where body ~* 'https?://')
  ) into result from public.chat_messages where conversation_id = target_conversation_id and deleted_at is null;
  return result;
end $$;

revoke all on function public.get_chat_sync_page(uuid,timestamptz,uuid,integer) from public, anon;
revoke all on function public.get_chat_unread_summary() from public, anon;
revoke all on function public.mark_chat_messages_read(uuid,uuid[]) from public, anon;
revoke all on function public.search_chat_messages(uuid,text,text,timestamptz,uuid) from public, anon;
revoke all on function public.get_chat_media_counts(uuid) from public, anon;
grant execute on function public.get_chat_sync_page(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_chat_unread_summary() to authenticated;
grant execute on function public.mark_chat_messages_read(uuid,uuid[]) to authenticated;
grant execute on function public.search_chat_messages(uuid,text,text,timestamptz,uuid) to authenticated;
grant execute on function public.get_chat_media_counts(uuid) to authenticated;
