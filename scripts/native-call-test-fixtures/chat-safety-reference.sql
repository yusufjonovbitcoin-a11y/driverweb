CREATE OR REPLACE FUNCTION public.can_access_chat_conversation(target_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.chat_conversations c
    where c.id = target_conversation_id
      and c.company_id = public.current_company_id()
      and (c.dispatcher_id = (select auth.uid()) or c.driver_id = (select auth.uid()))
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_upload_chat_media(target_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (select auth.uid()) is not null and length(target_path) <= 1024
    and split_part(target_path,'/',1)=public.current_company_id()::text
    and target_path !~ '(^|/)(\.{1,2})?(/|$)'
    and array_length(string_to_array(target_path,'/'),1)>=3
    and not exists(select 1 from public.chat_media_revocations r where r.storage_path=target_path)
    and exists(select 1 from public.chat_conversations c where c.id::text=split_part(target_path,'/',2)
      and c.company_id=public.current_company_id() and (select auth.uid()) in(c.dispatcher_id,c.driver_id));
$function$;

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(worker_id text, batch_size integer DEFAULT 100)
 RETURNS TABLE(notification_id uuid, device_id uuid, company_id uuid, recipient_id uuid, platform text, push_token text, title text, body text, notification_type text, entity_type text, entity_id uuid, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nullif(btrim(worker_id), '') is null then
    raise exception 'Worker id is required';
  end if;
  if coalesce(batch_size, 0) < 1 or batch_size > 500 then
    raise exception 'Batch size must be between 1 and 500';
  end if;

  update public.push_deliveries pd
  set status = 'cancelled',
      last_error = 'Push delivery worker lease expired after maximum attempts',
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where pd.status = 'processing'
    and pd.locked_at < clock_timestamp() - interval '5 minutes'
    and pd.attempt_count >= pd.max_attempts;

  return query
  with candidates as (
    select pd.notification_id, pd.device_id
    from public.push_deliveries pd
    join public.push_devices d on d.id = pd.device_id
    where (
        (pd.status in ('pending', 'failed')
          and pd.next_attempt_at <= clock_timestamp())
        or (pd.status = 'processing'
          and pd.locked_at < clock_timestamp() - interval '5 minutes')
      )
      and pd.attempt_count < pd.max_attempts
      and d.disabled_at is null
      and d.user_id = pd.recipient_id
      and d.company_id = pd.company_id
      and d.token = pd.token_snapshot
    order by pd.device_id, pd.next_attempt_at, pd.created_at,
      pd.notification_id
    limit batch_size
    for update of d, pd skip locked
  ), claimed as (
    update public.push_deliveries pd
    set status = 'processing',
        attempt_count = pd.attempt_count + 1,
        locked_at = now(),
        locked_by = btrim(worker_id),
        updated_at = now()
    from candidates c
    where pd.notification_id = c.notification_id
      and pd.device_id = c.device_id
    returning pd.*
  )
  select
    c.notification_id,
    c.device_id,
    c.company_id,
    c.recipient_id,
    c.platform,
    c.token_snapshot,
    n.title,
    n.body,
    n.type,
    n.entity_type,
    n.entity_id,
    c.attempt_count
  from claimed c
  join public.notifications n on n.id = c.notification_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.push_deliveries(
    notification_id, device_id, company_id, recipient_id, platform,
    token_snapshot
  )
  select
    new.id, d.id, new.company_id, new.recipient_id, d.platform, d.token
  from public.push_devices d
  where d.user_id = new.recipient_id
    and d.company_id = new.company_id
    and d.disabled_at is null
  on conflict (notification_id, device_id) do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_chat_context(conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_incoming_chat_calls()
 RETURNS SETOF chat_calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.recover_stale_chat_calls();
  return query select c.* from public.chat_calls c where c.recipient_id = (select auth.uid())
    and c.company_id = public.current_company_id() and c.status='ringing'
    and c.started_at >= clock_timestamp()-interval '90 seconds' order by c.started_at desc limit 10;
end $function$;

CREATE OR REPLACE FUNCTION public.heartbeat_chat_call(target_call_id uuid)
 RETURNS chat_calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.open_direct_chat(target_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.publish_chat_signal(call_id uuid, signal_kind chat_signal_kind, signal_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.respond_chat_call(call_id uuid, action text)
 RETURNS chat_calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.send_chat_message(conversation_id uuid, message_kind chat_message_kind, message_body text DEFAULT NULL::text, media_storage_path text DEFAULT NULL::text, media_file_name text DEFAULT NULL::text, media_mime_type text DEFAULT NULL::text, media_size_bytes bigint DEFAULT NULL::bigint, media_duration_ms integer DEFAULT NULL::integer, reply_to_message_id uuid DEFAULT NULL::uuid, message_client_id uuid DEFAULT gen_random_uuid())
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.start_chat_call(conversation_id uuid, call_kind chat_call_kind)
 RETURNS chat_calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
