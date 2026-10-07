-- Durable native call invitations. No APNs credentials or capability secrets live
-- in SQL or pg_net. Its public wake only points to an existing server-owned call.
create table public.voip_devices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 token text not null check(token ~ '^[0-9a-f]+$' and length(token) between 64 and 512), environment text not null check(environment in('sandbox','production')),
 bundle_id text not null check(bundle_id ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'),
 fcm_device_id uuid references public.push_devices(id) on delete set null,
 disabled_at timestamptz, updated_at timestamptz not null default now(),
 unique(token,environment,bundle_id), unique(fcm_device_id)
);
create index voip_devices_active_owner_idx on public.voip_devices(user_id,company_id) where disabled_at is null;
alter table public.voip_devices enable row level security;
revoke all on public.voip_devices from public,anon,authenticated;
grant select on public.voip_devices to authenticated;
create policy voip_devices_own_read on public.voip_devices for select to authenticated
 using(user_id=(select auth.uid()) and company_id=public.current_company_id());
alter table public.push_devices add column native_calls boolean not null default false;

create function public.register_native_call_device(fcm_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); changed uuid;
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 update public.push_devices set native_calls=true,updated_at=now()
 where token=fcm_token and user_id=actor.id and company_id=actor.company_id and disabled_at is null and platform in('android','ios') returning id into changed;
 return changed;
end $$;
revoke all on function public.register_native_call_device(text) from public,anon;
grant execute on function public.register_native_call_device(text) to authenticated;

create function public.register_voip_device(voip_token text,environment text,bundle_id text,fcm_token text default null)
returns public.voip_devices language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); saved public.voip_devices; linked uuid; normalized text:=lower(btrim(voip_token));
begin
 if actor.id is null or actor.status<>'active' or actor.company_id is null then raise exception 'Active authentication required'; end if;
 if normalized is null or normalized !~ '^[0-9a-f]+$' or length(normalized) not between 64 and 512 or environment is null or environment not in('sandbox','production')
   or bundle_id is null or bundle_id !~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' or length(bundle_id)>200 then raise exception 'Invalid VoIP registration'; end if;
 perform pg_advisory_xact_lock(hashtextextended('voip-token:'||normalized,741));
 perform pg_advisory_xact_lock(hashtextextended('voip-user:'||actor.id::text,741));
 if fcm_token is not null then
   -- Ownership must remain valid through the VoIP upsert. Use the same
   -- FCM-row -> VoIP-row order as account transfer and invalid-token cleanup.
   select id into linked from public.push_devices where token=fcm_token and user_id=actor.id and company_id=actor.company_id and platform='ios' and disabled_at is null for update;
   if linked is null then raise exception 'Owned iOS push device required'; end if;
 end if;
 if (select count(*) from public.voip_devices v where v.user_id=actor.id and v.disabled_at is null and
   (v.token,v.environment,v.bundle_id) is distinct from (normalized,register_voip_device.environment,register_voip_device.bundle_id))>=10 then raise exception 'VoIP device limit reached'; end if;
 -- Token rotation and account switch are serialized. A queued row retains its
 -- owner snapshot and becomes ineligible when ownership/token changes.
 if linked is not null then update public.voip_devices set fcm_device_id=null,disabled_at=now() where fcm_device_id=linked; end if;
 insert into public.voip_devices(user_id,company_id,token,environment,bundle_id,fcm_device_id)
 values(actor.id,actor.company_id,normalized,register_voip_device.environment,register_voip_device.bundle_id,linked)
 on conflict on constraint voip_devices_token_environment_bundle_id_key do update set user_id=excluded.user_id,company_id=excluded.company_id,
 fcm_device_id=excluded.fcm_device_id,disabled_at=null,updated_at=now() returning * into saved;
 return saved;
end $$;
create function public.unregister_voip_device(voip_token text,environment text,bundle_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); removed uuid;
begin
 if actor.id is null then raise exception 'Active authentication required'; end if;
 delete from public.voip_devices v where v.user_id=actor.id and v.company_id=actor.company_id and v.token=lower(btrim(voip_token))
   and v.environment=unregister_voip_device.environment and v.bundle_id=unregister_voip_device.bundle_id returning id into removed;
 return removed is not null;
end $$;
revoke all on function public.register_voip_device(text,text,text,text),public.unregister_voip_device(text,text,text) from public,anon;
grant execute on function public.register_voip_device(text,text,text,text),public.unregister_voip_device(text,text,text) to authenticated;

-- Logging out or moving an FCM token to another account must also invalidate
-- its linked VoIP registration, even before the new Flutter session re-registers.
create function private.invalidate_linked_voip_device() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or (new.user_id,new.company_id,new.token,new.disabled_at) is distinct from (old.user_id,old.company_id,old.token,old.disabled_at) then
   if tg_op='DELETE' or new.user_id<>old.user_id or new.company_id<>old.company_id or new.token<>old.token or new.disabled_at is not null then
     update public.voip_devices set disabled_at=clock_timestamp() where fcm_device_id=old.id;
   end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.invalidate_linked_voip_device() from public,anon,authenticated,service_role;
create trigger native_call_fcm_owner_guard before update of user_id,company_id,token,disabled_at or delete on public.push_devices
for each row execute function private.invalidate_linked_voip_device();

alter table public.chat_calls add column accepted_device_id uuid;

create function private.native_call_device_owned(p_device uuid,p_recipient uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.push_devices where id=p_device and user_id=p_recipient and company_id=p_company and disabled_at is null)
 or exists(select 1 from public.voip_devices where id=p_device and user_id=p_recipient and company_id=p_company and disabled_at is null)
$$;
revoke all on function private.native_call_device_owned(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.claim_native_chat_call(call_id uuid,device_id uuid) returns public.chat_calls
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); c public.chat_calls; conversation uuid; canonical uuid:=device_id;
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 select conversation_id into conversation from public.chat_calls where id=call_id and recipient_id=actor.id and company_id=actor.company_id;
 if conversation is null then raise exception 'Call access denied'; end if;
 perform private.assert_chat_write(conversation);
 select * into c from public.chat_calls where id=call_id and recipient_id=actor.id and company_id=actor.company_id for update;
 if not private.native_call_device_owned(device_id,actor.id,actor.company_id) then raise exception 'Owned call device required'; end if;
 select coalesce((select id from public.voip_devices where fcm_device_id=device_id and user_id=actor.id and company_id=actor.company_id and disabled_at is null),device_id) into canonical;
 if c.status='accepted' then
   if c.accepted_device_id=canonical then return c; end if;
   raise exception 'CALL_ANSWERED_ELSEWHERE';
 end if;
 if c.status<>'ringing' or c.started_at+interval '90 seconds'<=clock_timestamp() or not private.native_call_eligible(c) then raise exception 'Call is no longer ringing'; end if;
 update public.chat_calls set status='accepted',accepted_device_id=canonical,answered_at=now(),last_heartbeat_at=now(),
   initiator_heartbeat_at=now(),recipient_heartbeat_at=now() where id=c.id returning * into c;
 return c;
end $$;
revoke all on function public.claim_native_chat_call(uuid,uuid) from public,anon;
grant execute on function public.claim_native_chat_call(uuid,uuid) to authenticated;

-- Recipient-native actions must not let a losing device end the winner's call.
-- Legacy/outgoing termination remains in respond_chat_call.
create function public.finish_native_chat_call(call_id uuid,device_id uuid,action text) returns public.chat_calls
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.current_profile(); c public.chat_calls; conversation uuid; canonical uuid:=device_id;
begin
 if actor.id is null or actor.status<>'active' then raise exception 'Active authentication required'; end if;
 if action is null or action not in('declined','ended') then raise exception 'Unsupported native action'; end if;
 select conversation_id into conversation from public.chat_calls where id=call_id and recipient_id=actor.id and company_id=actor.company_id;
 if conversation is null then raise exception 'Call access denied'; end if;
 perform 1 from public.chat_conversations where id=conversation and company_id=actor.company_id and actor.id in(driver_id,dispatcher_id) for update;
 if not found then raise exception 'Call access denied'; end if;
 select * into c from public.chat_calls where id=call_id and recipient_id=actor.id and company_id=actor.company_id for update;
 if not private.native_call_device_owned(device_id,actor.id,actor.company_id) then raise exception 'Owned call device required'; end if;
 select coalesce((select id from public.voip_devices where fcm_device_id=device_id and user_id=actor.id and company_id=actor.company_id and disabled_at is null),device_id) into canonical;
 if c.status not in('ringing','accepted') then return c; end if;
 if c.status='accepted' and (action='declined' or c.accepted_device_id is distinct from canonical) then return c; end if;
 update public.chat_calls set status=action::public.chat_call_status,ended_at=now() where id=c.id returning * into c;
 delete from public.chat_call_signals s where s.call_id=c.id;
 return c;
end $$;
revoke all on function public.finish_native_chat_call(uuid,uuid,text) from public,anon;
grant execute on function public.finish_native_chat_call(uuid,uuid,text) to authenticated;

create table private.native_call_deliveries (
 id uuid primary key default gen_random_uuid(), call_id uuid not null references public.chat_calls(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade, device_id uuid not null,
 transport text not null check(transport in('fcm','apns_voip')), token_snapshot text not null,
 event text not null check(event in('incoming_call','call_ended')), call_status public.chat_call_status not null,
 status text not null default 'pending' check(status in('pending','processing','sent','failed','cancelled')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 locked_by text,locked_at timestamptz,expires_at timestamptz not null,created_at timestamptz not null default now(),
 last_error text,unique(call_id,recipient_id,device_id,transport,event,call_status)
);
alter table private.native_call_deliveries enable row level security;
revoke all on private.native_call_deliveries from public,anon,authenticated,service_role;
create index native_call_delivery_pending_idx on private.native_call_deliveries(next_attempt_at,created_at) where status in('pending','failed','processing');
create index native_call_delivery_call_idx on private.native_call_deliveries(call_id);

create function private.native_call_eligible(p_call public.chat_calls) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.chat_conversations c
 join public.profiles a on a.id=p_call.initiator_id and a.company_id=p_call.company_id and a.status='active'
 join public.profiles b on b.id=p_call.recipient_id and b.company_id=p_call.company_id and b.status='active'
 where c.id=p_call.conversation_id and c.company_id=p_call.company_id
 and p_call.initiator_id in(c.driver_id,c.dispatcher_id) and p_call.recipient_id in(c.driver_id,c.dispatcher_id)
 and not private.chat_pair_blocked(c.company_id,p_call.initiator_id,p_call.recipient_id))
$$;
revoke all on function private.native_call_eligible(public.chat_calls) from public,anon,authenticated,service_role;

create function private.enqueue_native_call_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare invite boolean; recipient uuid; event_name text; project_url text;
begin
 invite:=new.status='ringing' and tg_op='INSERT';
 if not invite and (tg_op<>'UPDATE' or new.status=old.status or new.status='ringing') then return new; end if;
 if invite and not private.native_call_eligible(new) then return new; end if;
 event_name:=case when invite then 'incoming_call' else 'call_ended' end;
 if not invite then
   update private.native_call_deliveries set status='cancelled',locked_by=null,locked_at=null,last_error='Call no longer ringing'
   where call_id=new.id and event='incoming_call' and status in('pending','failed','processing');
 end if;
 for recipient in select new.recipient_id union select new.initiator_id where not invite and new.status<>'accepted' loop
   insert into private.native_call_deliveries(call_id,company_id,recipient_id,device_id,transport,token_snapshot,event,call_status,expires_at)
   select new.id,new.company_id,recipient,d.id,'fcm',d.token,event_name,new.status,
     case when invite then new.started_at+interval '90 seconds' else clock_timestamp()+interval '2 minutes' end
   from public.push_devices d where d.user_id=recipient and d.company_id=new.company_id and d.disabled_at is null
   and (invite or d.platform<>'web')
   and (new.status<>'accepted' or new.accepted_device_id is null or
     coalesce((select v.id from public.voip_devices v where v.fcm_device_id=d.id and v.user_id=recipient and v.disabled_at is null),d.id)<>new.accepted_device_id)
   on conflict do nothing;
   if invite then
     insert into private.native_call_deliveries(call_id,company_id,recipient_id,device_id,transport,token_snapshot,event,call_status,expires_at)
     select new.id,new.company_id,recipient,d.id,'apns_voip',d.token,event_name,new.status,new.started_at+interval '90 seconds'
     from public.voip_devices d where d.user_id=recipient and d.company_id=new.company_id and d.disabled_at is null
     on conflict do nothing;
   end if;
 end loop;
 -- No bearer/capability/device token is ever persisted in pg_net's request queue.
 -- A crash can lose this hint but not the outbox; the trusted cron drain retries.
 begin
   select decrypted_secret into project_url from vault.decrypted_secrets where name='chat_cron_project_url';
   if project_url ~ '^https://[a-z0-9]{20}\.supabase\.co$' then
     perform net.http_post(url:=project_url||'/functions/v1/process-native-call-push',
       headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('call_id',new.id),timeout_milliseconds:=10000);
   end if;
 exception when others then null; end;
 return new;
end $$;
revoke all on function private.enqueue_native_call_delivery() from public,anon,authenticated,service_role;
create trigger native_call_delivery_after_change after insert or update of status on public.chat_calls
for each row execute function private.enqueue_native_call_delivery();

create function private.native_call_delivery_allowed(p_delivery private.native_call_deliveries) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c public.chat_calls;
begin
 if p_delivery.expires_at<=clock_timestamp() then return false; end if;
 select * into c from public.chat_calls where id=p_delivery.call_id and company_id=p_delivery.company_id;
 if c.id is null or p_delivery.recipient_id not in(c.initiator_id,c.recipient_id) then return false; end if;
 if p_delivery.event='incoming_call' and (c.status<>'ringing' or c.started_at+interval '90 seconds'<=clock_timestamp() or not private.native_call_eligible(c)) then return false; end if;
 if p_delivery.event='call_ended' and c.status='ringing' then return false; end if;
 if p_delivery.transport='apns_voip' and exists(select 1 from public.voip_devices v join private.native_call_deliveries f on f.device_id=v.fcm_device_id
   where v.id=p_delivery.device_id and f.call_id=p_delivery.call_id and f.transport='fcm' and f.event='incoming_call' and f.status='sent') then return false; end if;
 if p_delivery.transport='fcm' then
   return exists(select 1 from public.push_devices d where d.id=p_delivery.device_id and d.user_id=p_delivery.recipient_id
     and d.company_id=p_delivery.company_id and d.token=p_delivery.token_snapshot and d.disabled_at is null);
 end if;
 return p_delivery.event='incoming_call' and exists(select 1 from public.voip_devices d where d.id=p_delivery.device_id
   and d.user_id=p_delivery.recipient_id and d.company_id=p_delivery.company_id and d.token=p_delivery.token_snapshot and d.disabled_at is null);
end $$;
revoke all on function private.native_call_delivery_allowed(private.native_call_deliveries) from public,anon,authenticated,service_role;

create function public.claim_native_call_deliveries(p_worker_id text,p_call_id uuid default null,p_limit integer default 40)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare d private.native_call_deliveries;
begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 100 then raise exception 'Invalid worker'; end if;
 if p_call_id is null then
   delete from private.native_call_deliveries where id in(select id from private.native_call_deliveries where expires_at<clock_timestamp()-interval '7 days' order by expires_at limit 1000);
 end if;
 for d in select * from private.native_call_deliveries q where (p_call_id is null or q.call_id=p_call_id)
   and ((q.status in('pending','failed') and q.next_attempt_at<=clock_timestamp()) or (q.status='processing' and q.locked_at<clock_timestamp()-interval '20 seconds'))
   order by q.created_at,case when q.transport='apns_voip' then 0 else 1 end,q.id limit least(greatest(coalesce(p_limit,40),1),60) for update skip locked loop
   if d.attempts>=6 or not private.native_call_delivery_allowed(d) then
     update private.native_call_deliveries set status='cancelled',locked_by=null,locked_at=null where id=d.id; continue;
   end if;
   update private.native_call_deliveries set status='processing',locked_by=p_worker_id,locked_at=clock_timestamp(),attempts=attempts+1 where id=d.id;
   return next jsonb_build_object('delivery_id',d.id,'transport',d.transport);
 end loop;
end $$;
create function public.get_native_call_delivery(p_delivery_id uuid,p_worker_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d private.native_call_deliveries; c public.chat_calls; f public.push_devices; v public.voip_devices; fallback_status text;
begin
 select * into d from private.native_call_deliveries where id=p_delivery_id and status='processing' and locked_by=p_worker_id;
 if d.id is null or not private.native_call_delivery_allowed(d) then return null; end if;
 select * into c from public.chat_calls where id=d.call_id;
 if d.transport='fcm' then
   select * into f from public.push_devices where id=d.device_id;
   select * into v from public.voip_devices where fcm_device_id=f.id and user_id=d.recipient_id and company_id=d.company_id and disabled_at is null;
   if v.id is not null then select status into fallback_status from private.native_call_deliveries
     where call_id=d.call_id and device_id=v.id and transport='apns_voip' and event='incoming_call'; end if;
 else select * into v from public.voip_devices where id=d.device_id; end if;
 return jsonb_build_object('delivery_id',d.id,'call_id',c.id,'conversation_id',c.conversation_id,'recipient_id',d.recipient_id,
   'caller_name',(select left(full_name,200) from public.profiles where id=c.initiator_id),'call_kind',c.kind,'call_status',c.status,
   'started_at',c.started_at,'expires_at',d.expires_at,'event',d.event,'transport',d.transport,'token',d.token_snapshot,
   'action_device_id',coalesce(v.id,d.device_id),'accepted_device_id',c.accepted_device_id,
   'platform',f.platform,'native_calls',coalesce(f.native_calls,false),'environment',v.environment,'bundle_id',v.bundle_id,
   'voip_delivery_status',fallback_status,'attempts',d.attempts);
end $$;
create function public.finish_native_call_delivery(p_delivery_id uuid,p_worker_id text,p_outcome text,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.native_call_deliveries;
begin
 if p_outcome is null or p_outcome not in('sent','retry','cancelled','invalid_token','fallback') then raise exception 'Invalid outcome'; end if;
 select * into d from private.native_call_deliveries where id=p_delivery_id and status='processing' and locked_by=p_worker_id for update;
 if d.id is null then return false; end if;
 if p_outcome='invalid_token' then
   if d.transport='fcm' then
     -- An FCM provider rejection does not revoke a still-valid APNs endpoint.
     -- Unlink first; explicit logout/account transfer still disables VoIP.
     perform 1 from public.push_devices p where p.id=d.device_id and p.user_id=d.recipient_id
       and p.company_id=d.company_id and p.token=d.token_snapshot for update;
     if found then
       update public.voip_devices set fcm_device_id=null where fcm_device_id=d.device_id and user_id=d.recipient_id;
       update public.push_devices set disabled_at=now() where id=d.device_id and token=d.token_snapshot and user_id=d.recipient_id;
     end if;
   else update public.voip_devices set disabled_at=now() where id=d.device_id and token=d.token_snapshot and user_id=d.recipient_id; end if;
 end if;
 update private.native_call_deliveries set status=case when p_outcome='sent' then 'sent' when p_outcome='retry' then 'failed' else 'cancelled' end,
   locked_by=null,locked_at=null,next_attempt_at=clock_timestamp()+make_interval(secs=>least(24,2^least(d.attempts,5))::integer),last_error=left(p_error,200) where id=d.id;
 return true;
end $$;
revoke all on function public.claim_native_call_deliveries(text,uuid,integer),public.get_native_call_delivery(uuid,text),public.finish_native_call_delivery(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_native_call_deliveries(text,uuid,integer),public.get_native_call_delivery(uuid,text),public.finish_native_call_delivery(uuid,text,text,text) to service_role;

-- Only the capability-verifying Edge Function may call this service-only RPC.
-- It never accepts a call, and status is recomputed under the block lock.
create function public.native_call_action(p_call_id uuid,p_recipient_id uuid,p_device_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.chat_calls; conversation uuid; answerable boolean; current_status text;
begin
 if p_action is null or p_action not in('status','decline') then raise exception 'Unsupported native action'; end if;
 select conversation_id into conversation from public.chat_calls where id=p_call_id and recipient_id=p_recipient_id;
 if conversation is null then return null; end if;
 perform 1 from public.chat_conversations where id=conversation for update;
 select * into c from public.chat_calls where id=p_call_id and recipient_id=p_recipient_id for update;
 if c.id is null then return null; end if;
 if not private.native_call_device_owned(p_device_id,p_recipient_id,c.company_id) then return null; end if;
 answerable:=c.status='ringing' and c.started_at+interval '90 seconds'>clock_timestamp() and private.native_call_eligible(c);
 if p_action='decline' and answerable then
   update public.chat_calls set status='declined',ended_at=now() where id=c.id returning * into c;
   delete from public.chat_call_signals s where s.call_id=c.id;
   answerable:=false;
 end if;
 current_status:=case when c.status='ringing' and not answerable then
   case when c.started_at+interval '90 seconds'<=clock_timestamp() then 'missed' else 'ended' end else c.status::text end;
 return jsonb_build_object('call_id',c.id,'status',current_status,'can_answer',answerable,'accepted_device_id',c.accepted_device_id,'expires_at',c.started_at+interval '90 seconds');
end $$;
revoke all on function public.native_call_action(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.native_call_action(uuid,uuid,uuid,text) to service_role;

do $$ declare definition text:=pg_get_functiondef('public.respond_chat_call(uuid,text)'::regprocedure); begin
 if strpos(definition, '  if saved.status::text=action')=0 then raise exception 'Unexpected call response'; end if;
 execute replace(definition,'  if saved.status::text=action',E'  if action=\'accepted\' and saved.accepted_device_id is not null then raise exception \'CALL_ANSWERED_ELSEWHERE\'; end if;\n  if saved.status::text=action');
end $$;

-- The normal registration path resets opt-in until the native-capable client
-- explicitly confirms it again (also prevents token ownership transfer leaks).
do $$ declare definition text:=pg_get_functiondef('public.register_push_device(text,text)'::regprocedure); begin
 if strpos(definition,'    disabled_at = null,')=0 then raise exception 'Unexpected push registration'; end if;
 execute replace(definition,'    disabled_at = null,',E'    disabled_at = null,\n    native_calls = false,');
end $$;

-- Keep credentials in the existing Vault-backed synchronous cron transport.
-- Immediate pg_net wake contains only a call UUID; cron is the durable fallback.
alter table worker_cron.last_invocations drop constraint last_invocations_worker_check;
alter table worker_cron.last_invocations add constraint last_invocations_worker_check check(worker in('push','media','document','native_calls'));
do $$ declare definition text:=pg_get_functiondef('worker_cron.invoke(text)'::regprocedure); begin
 if strpos(definition,E'    when \'media\' then')=0 then raise exception 'Unexpected worker invocation'; end if;
 definition:=replace(definition,E'    when \'media\' then',E'    when \'native_calls\' then\n      secret_name := \'chat_push_cron_token\';\n      endpoint := \'process-native-call-push\';\n    when \'media\' then');
 definition:=replace(definition,'''55000''','case when worker_name=''native_calls'' then ''12000'' else ''55000'' end');
 execute definition;
end $$;
-- Activation is deliberately a separate release step after endpoint/secret checks.
-- select cron.schedule('native-call-delivery','5 seconds',$$select worker_cron.invoke('native_calls')$$);
notify pgrst,'reload schema';
