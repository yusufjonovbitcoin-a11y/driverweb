-- Keep this filename aligned with the applied production migration version.
begin;
alter table public.push_devices
  add column web_calls_enabled boolean not null default true,
  add column web_messages_enabled boolean not null default true;

create function public.set_web_push_preferences(p_token text,p_calls boolean,p_messages boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles := public.current_profile();
begin
  if actor.id is null or actor.status<>'active' or actor.company_id is null then
    raise exception 'Active company profile required';
  end if;
  if p_calls is null or p_messages is null then raise exception 'Push preferences required'; end if;
  update public.push_devices set web_calls_enabled=p_calls,web_messages_enabled=p_messages,updated_at=now()
    where token=btrim(p_token) and user_id=actor.id and company_id=actor.company_id
      and platform='web' and disabled_at is null;
  if not found then raise exception 'Owned web push device required'; end if;
end $$;
revoke all on function public.set_web_push_preferences(text,boolean,boolean) from public,anon;
grant execute on function public.set_web_push_preferences(text,boolean,boolean) to authenticated;

-- Preserve every native lease/expiry/ownership check; only web invitation
-- eligibility gains a current device preference check, including queued work.
create or replace function private.native_call_delivery_allowed(p_delivery private.native_call_deliveries) returns boolean
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
     and d.company_id=p_delivery.company_id and d.token=p_delivery.token_snapshot and d.disabled_at is null
     and (d.platform<>'web' or p_delivery.event<>'incoming_call' or d.web_calls_enabled));
 end if;
 return p_delivery.event='incoming_call' and exists(select 1 from public.voip_devices d where d.id=p_delivery.device_id
   and d.user_id=p_delivery.recipient_id and d.company_id=p_delivery.company_id and d.token=p_delivery.token_snapshot and d.disabled_at is null);
end $$;
revoke all on function private.native_call_delivery_allowed(private.native_call_deliveries) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
