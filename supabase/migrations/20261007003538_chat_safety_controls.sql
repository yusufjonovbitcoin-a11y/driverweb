-- App Store chat safety: reviewed and verified in an isolated PostgreSQL cluster.
-- Reporting/blocking and a deliberately limited English text rule set.
-- Does not claim comprehensive media moderation or a staffed response process.
begin;

create schema if not exists private;
revoke all on schema private from public;

create table public.chat_user_blocks (
  company_id uuid not null references public.companies(id) on delete cascade,
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check(blocker_id<>blocked_id)
);
create index chat_user_blocks_reverse_idx on public.chat_user_blocks(blocked_id,blocker_id);
alter table public.chat_user_blocks enable row level security;
revoke all on public.chat_user_blocks from public,anon,authenticated;
grant select on public.chat_user_blocks to authenticated;
create policy chat_blocks_owner_read on public.chat_user_blocks for select to authenticated
 using(company_id=public.current_company_id() and blocker_id=(select auth.uid()));

create table public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id),
  message_id uuid not null references public.chat_messages(id),
  reporter_id uuid not null references public.profiles(id),
  reported_user_id uuid not null references public.profiles(id),
  reason text not null check(reason in('harassment','inappropriate_content','spam','threats','other')),
  details text check(char_length(details)<=2000),
  evidence jsonb not null,
  status text not null default 'open' check(status in('open','reviewed','dismissed','action_taken')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  moderator_note text check(char_length(moderator_note)<=2000),
  unique(reporter_id,message_id),
  check(reporter_id<>reported_user_id)
);
create index chat_reports_company_queue_idx on public.chat_reports(company_id,status,created_at,id);
alter table public.chat_reports enable row level security;
revoke all on public.chat_reports from public,anon,authenticated;
-- Read through the explicit RPCs: reporter receives only its own report ID/status.
-- Admin queue excludes the accused even when they are a company administrator.

create function private.chat_pair_blocked(p_company uuid,p_first uuid,p_second uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.chat_user_blocks b where b.company_id=p_company
   and ((b.blocker_id=p_first and b.blocked_id=p_second)
     or (b.blocker_id=p_second and b.blocked_id=p_first)))
$$;
revoke all on function private.chat_pair_blocked(uuid,uuid,uuid) from public,anon,authenticated;

create function public.can_write_chat_conversation(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.chat_conversations c join public.profiles p on p.id=auth.uid()
   where c.id=target_conversation_id and p.status='active' and c.company_id=p.company_id
     and p.id in(c.dispatcher_id,c.driver_id)
     and not private.chat_pair_blocked(c.company_id,c.dispatcher_id,c.driver_id))
$$;
revoke all on function public.can_write_chat_conversation(uuid) from public,anon;
grant execute on function public.can_write_chat_conversation(uuid) to authenticated;

-- Every write path takes the conversation lock before message/call row locks.
-- The block transaction shares this lock, so a send cannot commit after a block
-- and then create an unread notification. Existing message history stays visible.
create function private.assert_chat_write(p_conversation uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.chat_conversations; actor public.profiles:=public.current_profile();
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 select * into c from public.chat_conversations where id=p_conversation
   and company_id=actor.company_id and actor.id in(dispatcher_id,driver_id) for update;
 if c.id is null then raise exception 'Chat access denied'; end if;
 if private.chat_pair_blocked(c.company_id,c.dispatcher_id,c.driver_id) then raise exception 'CHAT_BLOCKED'; end if;
end $$;
revoke all on function private.assert_chat_write(uuid) from public,anon,authenticated;

create function private.assert_chat_call_write(p_call uuid)
returns void language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 select c.conversation_id into cid from public.chat_calls c where c.id=p_call
   and c.company_id=public.current_company_id() and auth.uid() in(c.initiator_id,c.recipient_id);
 if cid is null then raise exception 'Call access denied'; end if;
 perform private.assert_chat_write(cid);
end $$;
revoke all on function private.assert_chat_call_write(uuid) from public,anon,authenticated;

create function private.assert_chat_message_write(p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 select m.conversation_id into cid from public.chat_messages m where m.id=p_message
   and m.company_id=public.current_company_id() and m.sender_id=auth.uid();
 if cid is null then raise exception 'Message access denied'; end if;
 perform private.assert_chat_write(cid);
end $$;
revoke all on function private.assert_chat_message_write(uuid) from public,anon,authenticated;

create function private.assert_chat_text(p_text text)
returns void language plpgsql set search_path='' as $$
begin
 -- Whole words avoid blocking operational words such as "assignment" or "class".
 -- This is a small English baseline, not an exhaustive multilingual classifier.
 if coalesce(p_text,'') ~* '\m(fuck|fucking|motherfucker|cunt)\M'
   or coalesce(p_text,'') ~* '\m(kill[[:space:]]+yourself|i[[:space:]]+will[[:space:]]+kill[[:space:]]+you)\M'
 then raise exception 'CHAT_CONTENT_REJECTED'; end if;
end $$;
revoke all on function private.assert_chat_text(text) from public,anon,authenticated;

create function public.get_chat_safety_state(conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.chat_conversations; actor public.profiles:=public.current_profile();
 peer uuid; mine boolean; theirs boolean;
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 select * into c from public.chat_conversations where id=conversation_id
   and company_id=actor.company_id and actor.id in(dispatcher_id,driver_id);
 if c.id is null then raise exception 'Chat access denied'; end if;
 peer:=case when actor.id=c.driver_id then c.dispatcher_id else c.driver_id end;
 mine:=exists(select 1 from public.chat_user_blocks where blocker_id=actor.id and blocked_id=peer and company_id=c.company_id);
 theirs:=exists(select 1 from public.chat_user_blocks where blocker_id=peer and blocked_id=actor.id and company_id=c.company_id);
 return jsonb_build_object('conversationId',c.id,'otherUserId',peer,'blockedByMe',mine,
   'blockedByOther',theirs,'canSend',not(mine or theirs),'canCall',not(mine or theirs));
end $$;
revoke all on function public.get_chat_safety_state(uuid) from public,anon;
grant execute on function public.get_chat_safety_state(uuid) to authenticated;

create function private.chat_notification_allowed(p_notification uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare n public.notifications; c public.chat_conversations;
begin
 select * into n from public.notifications where id=p_notification;
 if n.id is null then return false; end if;
 if n.entity_type='chat_conversation' then
   select * into c from public.chat_conversations where id=n.entity_id and company_id=n.company_id;
 elsif n.entity_type='chat_call' then
   select conv.* into c from public.chat_calls call join public.chat_conversations conv on conv.id=call.conversation_id
   where call.id=n.entity_id and call.company_id=n.company_id;
 elsif n.chat_message_id is not null then
   select conv.* into c from public.chat_messages m join public.chat_conversations conv on conv.id=m.conversation_id
   where m.id=n.chat_message_id and m.company_id=n.company_id;
 else return true;
 end if;
 return c.id is not null and n.recipient_id in(c.dispatcher_id,c.driver_id)
   and not private.chat_pair_blocked(c.company_id,c.dispatcher_id,c.driver_id);
end $$;
revoke all on function private.chat_notification_allowed(uuid) from public,anon,authenticated;
create function public.chat_push_delivery_allowed(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.chat_notification_allowed(p_notification_id)
$$;
revoke all on function public.chat_push_delivery_allowed(uuid) from public,anon,authenticated;
grant execute on function public.chat_push_delivery_allowed(uuid) to service_role;

create function public.set_chat_user_block(target_user_id uuid,is_blocked boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); c public.chat_conversations;
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 if is_blocked is null or target_user_id is null or target_user_id=actor.id then raise exception 'Invalid block target'; end if;
 select * into c from public.chat_conversations where company_id=actor.company_id
   and ((dispatcher_id=actor.id and driver_id=target_user_id) or (driver_id=actor.id and dispatcher_id=target_user_id)) for update;
 if c.id is null then raise exception 'Chat access denied'; end if;
 if is_blocked then
   insert into public.chat_user_blocks(company_id,blocker_id,blocked_id) values(actor.company_id,actor.id,target_user_id)
     on conflict(blocker_id,blocked_id) do nothing;
   update public.chat_calls set status='ended',ended_at=coalesce(ended_at,now())
     where conversation_id=c.id and company_id=c.company_id and status in('ringing','accepted');
   delete from public.chat_call_signals where call_id in(select id from public.chat_calls where conversation_id=c.id);
   update public.push_deliveries d set status='cancelled',locked_at=null,locked_by=null,last_error='Chat blocked',updated_at=now()
     where d.company_id=c.company_id and d.status in('pending','processing','failed')
       and not private.chat_notification_allowed(d.notification_id);
   update public.notifications n set read_at=coalesce(read_at,now()) where n.company_id=c.company_id
     and n.recipient_id in(c.driver_id,c.dispatcher_id) and not private.chat_notification_allowed(n.id);
 else
   delete from public.chat_user_blocks where company_id=actor.company_id and blocker_id=actor.id and blocked_id=target_user_id;
 end if;
 return public.get_chat_safety_state(c.id);
end $$;
revoke all on function public.set_chat_user_block(uuid,boolean) from public,anon;
grant execute on function public.set_chat_user_block(uuid,boolean) to authenticated;

create function public.report_chat_message(target_message_id uuid,reason text,details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); m public.chat_messages; c public.chat_conversations; rid uuid;
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 if reason is null or reason not in('harassment','inappropriate_content','spam','threats','other')
   or char_length(coalesce(details,''))>2000 then raise exception 'Invalid report'; end if;
 select * into m from public.chat_messages where id=target_message_id and company_id=actor.company_id and sender_id<>actor.id;
 select * into c from public.chat_conversations where id=m.conversation_id and company_id=actor.company_id
   and actor.id in(driver_id,dispatcher_id);
 if m.id is null or c.id is null then raise exception 'Report access denied'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text,7741));
 select id into rid from public.chat_reports where reporter_id=actor.id and message_id=m.id;
 if rid is not null then return rid; end if;
 if (select count(*) from public.chat_reports where reporter_id=actor.id and created_at>now()-interval '1 hour')>=20
   then raise exception 'CHAT_REPORT_RATE_LIMIT'; end if;
 insert into public.chat_reports(company_id,conversation_id,message_id,reporter_id,reported_user_id,reason,details,evidence)
 values(actor.company_id,c.id,m.id,actor.id,m.sender_id,reason,nullif(btrim(details),''),
   jsonb_build_object('kind',m.kind,'body',m.body,'fileName',m.file_name,'storagePath',m.storage_path,
     'mimeType',m.mime_type,'createdAt',m.created_at,'revision',m.revision,'deletedAt',m.deleted_at)) returning id into rid;
 -- Notify only same-company active administrators who are not the accused.
 -- Platform moderation queue handles reports about the sole company admin.
 insert into public.notifications(company_id,recipient_id,type,title,body,entity_type,entity_id)
 select actor.company_id,p.id,'chat_report','Chat report received',
   'A member reported a chat message. Open the moderation queue to review it.','chat_report',rid
 from public.profiles p where p.company_id=actor.company_id and p.role='company_admin'
   and p.status='active' and p.id<>m.sender_id;
 return rid;
end $$;
revoke all on function public.report_chat_message(uuid,text,text) from public,anon;
grant execute on function public.report_chat_message(uuid,text,text) to authenticated;

create function public.list_chat_reports(report_status text default 'open',requested_limit integer default 50)
returns setof public.chat_reports language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile();
begin
 if actor.id is null or actor.status<>'active' or actor.role not in('company_admin','super_admin') then raise exception 'Moderator permission required'; end if;
 if report_status is null or report_status not in('open','reviewed','dismissed','action_taken') then raise exception 'Invalid report status'; end if;
 return query select r.* from public.chat_reports r where r.status=report_status
   and r.reported_user_id<>actor.id and (actor.role='super_admin' or r.company_id=actor.company_id)
   order by r.created_at,r.id limit greatest(1,least(coalesce(requested_limit,50),100));
end $$;
revoke all on function public.list_chat_reports(text,integer) from public,anon;
grant execute on function public.list_chat_reports(text,integer) to authenticated;

create function public.resolve_chat_report(report_id uuid,resolution text,moderator_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); result uuid;
begin
 if actor.id is null or actor.status<>'active' or actor.role not in('company_admin','super_admin') then raise exception 'Moderator permission required'; end if;
 if resolution is null or resolution not in('reviewed','dismissed','action_taken')
   or nullif(btrim(moderator_note),'') is null or char_length(moderator_note)>2000 then raise exception 'Invalid resolution'; end if;
 update public.chat_reports r set status=resolution,reviewed_at=now(),reviewed_by=actor.id,moderator_note=resolve_chat_report.moderator_note
 where r.id=report_id and r.reported_user_id<>actor.id and (actor.role='super_admin' or r.company_id=actor.company_id)
 returning id into result;
 if result is null then raise exception 'Report access denied'; end if;
 return result;
end $$;
revoke all on function public.resolve_chat_report(uuid,text,text) from public,anon;
grant execute on function public.resolve_chat_report(uuid,text,text) to authenticated;

-- Narrow checked patches preserve deployed validation/idempotency/privacy logic.
-- Refuse unexpected definitions rather than silently deploying a partial guard.
do $patch$
declare entry record; definition text; marker text:=E'\nbegin\n'; hook text;
begin
 for entry in select * from (values
   ('public.send_chat_message(uuid,public.chat_message_kind,text,text,text,text,bigint,integer,uuid,uuid)',
    E'  perform private.assert_chat_write(conversation_id);\n  perform private.assert_chat_text(message_body);'),
   ('public.edit_chat_message(uuid,text)',
    E'  perform private.assert_chat_message_write(target_message_id);\n  perform private.assert_chat_text(new_body);'),
   ('public.start_chat_call(uuid,public.chat_call_kind)',E'  perform private.assert_chat_write(conversation_id);'),
   ('public.respond_chat_call(uuid,text)',E'  if action=\'accepted\' then perform private.assert_chat_call_write(call_id); end if;'),
   ('public.heartbeat_chat_call(uuid)',E'  perform private.assert_chat_call_write(target_call_id);'),
   ('public.publish_chat_signal(uuid,public.chat_signal_kind,jsonb)',E'  perform private.assert_chat_call_write(call_id);')
 ) hooks(signature,source) loop
   definition:=pg_get_functiondef(entry.signature::regprocedure);
   if strpos(definition,marker)=0 or strpos(definition,'private.assert_chat_')>0 then raise exception 'Unexpected chat write definition: %',entry.signature; end if;
   definition:=replace(definition,marker,marker||entry.source||E'\n');
   execute definition;
 end loop;
 definition:=pg_get_functiondef('public.can_upload_chat_media(text)'::regprocedure);
 -- Read permission previously reused the upload predicate. Preserve its
 -- original path checks in a private helper so blocks do not erase history.
 execute replace(definition,'public.can_upload_chat_media','private.chat_media_path_accessible');
 revoke all on function private.chat_media_path_accessible(text) from public,anon,authenticated;
 hook:='and c.company_id=public.current_company_id() and (select auth.uid()) in(c.dispatcher_id,c.driver_id)';
 if strpos(definition,hook)=0 then raise exception 'Unexpected chat upload definition'; end if;
 execute replace(definition,hook,hook||' and public.can_write_chat_conversation(c.id)');
 definition:=pg_get_functiondef('public.can_read_chat_media(text,text)'::regprocedure);
 if strpos(definition,'public.can_upload_chat_media(target_path)')=0 then raise exception 'Unexpected chat media read definition'; end if;
 execute replace(definition,'public.can_upload_chat_media(target_path)','private.chat_media_path_accessible(target_path)');
 definition:=pg_get_functiondef('public.enqueue_push_notification()'::regprocedure);
 if strpos(definition,marker)=0 then raise exception 'Unexpected push enqueue definition'; end if;
 execute replace(definition,marker,marker||E'  if not private.chat_notification_allowed(new.id) then return new; end if;\n');
 definition:=pg_get_functiondef('public.claim_push_deliveries(text,integer)'::regprocedure);
 hook:='and d.token = pd.token_snapshot';
 if strpos(definition,hook)=0 then raise exception 'Unexpected push claim definition'; end if;
 execute replace(definition,hook,hook||' and private.chat_notification_allowed(pd.notification_id)');
end $patch$;

notify pgrst,'reload schema';
commit;
