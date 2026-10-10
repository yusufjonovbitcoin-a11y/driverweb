-- Paused infrastructure only. No controls are seeded, no credentials copied,
-- no schedules created and no existing Gmail connection/cursor is changed.
create table public.gmail_cloud_worker_controls (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  lease_owner uuid,
  lease_until timestamptz,
  connection_id uuid,
  configuration_version bigint,
  uid_validity text,
  updated_at timestamptz not null default clock_timestamp(),
  check ((lease_owner is null) = (lease_until is null)),
  check ((connection_id is null) = (configuration_version is null)),
  check (configuration_version is null or configuration_version >= 1),
  check (uid_validity is null or (uid_validity ~ '^[1-9][0-9]{0,9}$'
    and uid_validity::bigint <= 4294967295))
);
alter table public.gmail_cloud_worker_controls enable row level security;
revoke all on public.gmail_cloud_worker_controls from public, anon, authenticated;
grant select, insert, update, delete on public.gmail_cloud_worker_controls to service_role;
create policy gmail_cloud_worker_service on public.gmail_cloud_worker_controls
  for all to service_role using (true) with check (true);

-- Toggling the switch must not let an old owner resume after disable/re-enable.
create function public.invalidate_gmail_cloud_worker_lease()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.enabled is distinct from old.enabled then
    new.lease_owner := null;
    new.lease_until := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.invalidate_gmail_cloud_worker_lease() from public, anon, authenticated;
grant execute on function public.invalidate_gmail_cloud_worker_lease() to service_role;
create trigger gmail_cloud_worker_switch_fence before update
  on public.gmail_cloud_worker_controls for each row
  execute function public.invalidate_gmail_cloud_worker_lease();

create function public.claim_gmail_cloud_worker(
  p_company_id uuid, p_owner uuid, p_lease_seconds integer default 120
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_control public.gmail_cloud_worker_controls%rowtype;
  v_connection public.gmail_connections%rowtype;
  v_until timestamptz;
begin
  if p_company_id is null or p_owner is null or p_lease_seconds is null
    or p_lease_seconds not between 15 and 300 then
    raise exception 'INVALID_WORKER_ARGUMENT';
  end if;
  -- Always lock controls before connections. Short RPC transactions only;
  -- network/IMAP work must never run while a database transaction stays open.
  select * into v_control from public.gmail_cloud_worker_controls
    where company_id = p_company_id for update;
  if not found or not v_control.enabled then
    return jsonb_build_object('status', 'paused', 'reason', 'worker_disabled');
  end if;
  if v_control.lease_until > clock_timestamp() then
    return jsonb_build_object('status', 'busy', 'reason', 'lease_active');
  end if;
  select * into v_connection from public.gmail_connections
    where company_id = p_company_id and status = 'active' for update;
  if not found then
    return jsonb_build_object('status', 'unavailable', 'reason', 'connection_inactive');
  end if;
  if v_connection.provider_history_id is not null and
    (v_connection.provider_history_id !~ '^[0-9]{1,10}$'
      or v_connection.provider_history_id::bigint > 4294967295) then
    return jsonb_build_object('status', 'unavailable', 'reason', 'invalid_cursor');
  end if;
  if (v_control.connection_id, v_control.configuration_version) is distinct from
    (v_connection.id, v_connection.configuration_version) then
    v_control.uid_validity := null;
  end if;
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);
  update public.gmail_cloud_worker_controls set
    lease_owner = p_owner, lease_until = v_until,
    connection_id = v_connection.id,
    configuration_version = v_connection.configuration_version,
    uid_validity = v_control.uid_validity
    where company_id = p_company_id;
  return jsonb_build_object('status', 'claimed', 'company_id', p_company_id,
    'connection_id', v_connection.id,
    'configuration_version', v_connection.configuration_version,
    'provider_history_id', v_connection.provider_history_id,
    'uid_validity', v_control.uid_validity, 'lease_until', v_until);
end;
$$;

create function public.assert_gmail_cloud_worker(
  p_company_id uuid, p_owner uuid, p_connection_id uuid,
  p_configuration_version bigint, p_uid_validity text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_control public.gmail_cloud_worker_controls%rowtype;
  v_connection public.gmail_connections%rowtype;
begin
  select * into v_control from public.gmail_cloud_worker_controls
    where company_id = p_company_id for update;
  if not found or not v_control.enabled then
    return jsonb_build_object('status', 'lost', 'reason', 'worker_disabled');
  end if;
  if p_owner is null or v_control.lease_owner is distinct from p_owner
    or v_control.lease_until is null or v_control.lease_until <= clock_timestamp() then
    return jsonb_build_object('status', 'lost', 'reason', 'lease_lost');
  end if;
  if p_connection_id is null or p_configuration_version is null or
    (v_control.connection_id, v_control.configuration_version) is distinct from
    (p_connection_id, p_configuration_version) then
    return jsonb_build_object('status', 'lost', 'reason', 'configuration_changed');
  end if;
  select * into v_connection from public.gmail_connections
    where company_id = p_company_id and id = p_connection_id for update;
  if not found or v_connection.status <> 'active'
    or v_connection.configuration_version is distinct from p_configuration_version then
    return jsonb_build_object('status', 'lost', 'reason', 'configuration_changed');
  end if;
  -- Recheck after any wait for the connection lock.
  if v_control.lease_until <= clock_timestamp() then
    return jsonb_build_object('status', 'lost', 'reason', 'lease_expired');
  end if;
  if p_uid_validity is not null then
    if p_uid_validity !~ '^[1-9][0-9]{0,9}$' or p_uid_validity::bigint > 4294967295 then
      return jsonb_build_object('status', 'uid_validity_mismatch', 'reason', 'invalid_uid_validity');
    end if;
    if v_control.uid_validity is null then
      -- No implicit baseline, even for an empty/zero cursor. An operator must verify
      -- and explicitly seed the exact connection/version/UIDVALIDITY before
      -- enabling. Never silently adopt or reset a mailbox generation/cursor.
      return jsonb_build_object('status', 'uid_validity_unverified', 'reason', 'uid_validity_baseline_required');
    elsif v_control.uid_validity <> p_uid_validity then
      return jsonb_build_object('status', 'uid_validity_mismatch', 'reason', 'mailbox_generation_changed');
    end if;
  end if;
  return jsonb_build_object('status', 'valid', 'provider_history_id', v_connection.provider_history_id);
end;
$$;

create function public.heartbeat_gmail_cloud_worker(
  p_company_id uuid, p_owner uuid, p_connection_id uuid,
  p_configuration_version bigint, p_lease_seconds integer default 120
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_until timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then
    raise exception 'INVALID_WORKER_ARGUMENT';
  end if;
  v_result := public.assert_gmail_cloud_worker(p_company_id, p_owner,
    p_connection_id, p_configuration_version);
  if v_result->>'status' <> 'valid' then return v_result; end if;
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);
  update public.gmail_cloud_worker_controls set lease_until = v_until
    where company_id = p_company_id;
  return jsonb_build_object('status', 'valid', 'lease_until', v_until);
end;
$$;

create function public.checkpoint_gmail_cloud_worker(
  p_company_id uuid, p_owner uuid, p_connection_id uuid,
  p_configuration_version bigint, p_uid_validity text, p_last_uid bigint
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_current text;
begin
  v_result := public.assert_gmail_cloud_worker(p_company_id, p_owner,
    p_connection_id, p_configuration_version, p_uid_validity);
  if v_result->>'status' <> 'valid' then return v_result; end if;
  if p_uid_validity is null then
    return jsonb_build_object('status', 'uid_validity_unverified', 'reason', 'uid_validity_required');
  end if;
  v_current := v_result->>'provider_history_id';
  if p_last_uid is null or p_last_uid not between 0 and 4294967295 or
    (v_current is not null and (v_current !~ '^[0-9]{1,10}$'
      or v_current::bigint > 4294967295)) then
    return jsonb_build_object('status', 'invalid_cursor', 'reason', 'invalid_cursor');
  end if;
  -- Both rows remain locked from assert. Late/replayed checkpoints cannot lower
  -- a UID, nor commit after another owner or configuration has taken over.
  p_last_uid := greatest(p_last_uid, coalesce(v_current::bigint, 0));
  update public.gmail_connections set provider_history_id = p_last_uid::text,
    last_synced_at = clock_timestamp(), last_error = null
    where id = p_connection_id and company_id = p_company_id;
  return jsonb_build_object('status', 'checkpointed', 'provider_history_id', p_last_uid::text);
end;
$$;

create function public.release_gmail_cloud_worker(
  p_company_id uuid, p_owner uuid, p_connection_id uuid, p_configuration_version bigint
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := public.assert_gmail_cloud_worker(p_company_id, p_owner,
    p_connection_id, p_configuration_version);
  if v_result->>'status' <> 'valid' then return v_result; end if;
  update public.gmail_cloud_worker_controls set lease_owner = null, lease_until = null
    where company_id = p_company_id;
  return jsonb_build_object('status', 'released');
end;
$$;

revoke all on function public.claim_gmail_cloud_worker(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.assert_gmail_cloud_worker(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.heartbeat_gmail_cloud_worker(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.checkpoint_gmail_cloud_worker(uuid, uuid, uuid, bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.release_gmail_cloud_worker(uuid, uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_gmail_cloud_worker(uuid, uuid, integer) to service_role;
grant execute on function public.assert_gmail_cloud_worker(uuid, uuid, uuid, bigint, text) to service_role;
grant execute on function public.heartbeat_gmail_cloud_worker(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function public.checkpoint_gmail_cloud_worker(uuid, uuid, uuid, bigint, text, bigint) to service_role;
grant execute on function public.release_gmail_cloud_worker(uuid, uuid, uuid, bigint) to service_role;

-- Maintenance shares the same fenced company lease. These helpers do nothing
-- when paused, expired, reconfigured or missing an operator-verified baseline.
create function public.recover_gmail_cloud_label_jobs(
  p_company_id uuid, p_owner uuid, p_connection_id uuid,
  p_configuration_version bigint, p_limit integer default 10
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_count integer;
begin
  v_result := public.assert_gmail_cloud_worker(p_company_id, p_owner,
    p_connection_id, p_configuration_version);
  if v_result->>'status' <> 'valid' then return v_result; end if;
  if (select uid_validity from public.gmail_cloud_worker_controls where company_id=p_company_id) is null then
    return jsonb_build_object('status','uid_validity_unverified','reason','uid_validity_baseline_required');
  end if;
  if p_limit is null or p_limit not between 1 and 25 then raise exception 'INVALID_WORKER_ARGUMENT'; end if;
  with stale as (
    select j.id from public.jobs j
    where j.company_id=p_company_id
      and j.type in ('gmail_create_driver_label','gmail_label_assignment')
      and j.status='processing'
      and j.locked_at < clock_timestamp()-interval '120 seconds'
      and j.locked_by is distinct from 'gmail-cloud:' || p_owner::text
    order by j.locked_at,j.id limit p_limit for update skip locked
  )
  update public.jobs j set
    status=case when j.attempt_count>=j.max_attempts then 'dead_letter'::public.job_status else 'failed'::public.job_status end,
    available_at=clock_timestamp(),locked_at=null,locked_by=null,last_error='Gmail worker lease expired'
  from stale where j.id=stale.id;
  get diagnostics v_count=row_count;
  return jsonb_build_object('status','recovered','count',v_count);
end;
$$;

create function public.select_gmail_cloud_pending_attachments(
  p_company_id uuid, p_owner uuid, p_connection_id uuid,
  p_configuration_version bigint, p_limit integer default 10
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_attachments jsonb;
begin
  v_result := public.assert_gmail_cloud_worker(p_company_id, p_owner,
    p_connection_id, p_configuration_version);
  if v_result->>'status' <> 'valid' then return v_result; end if;
  if (select uid_validity from public.gmail_cloud_worker_controls where company_id=p_company_id) is null then
    return jsonb_build_object('status','uid_validity_unverified','reason','uid_validity_baseline_required');
  end if;
  if p_limit is null or p_limit not between 1 and 25 then raise exception 'INVALID_WORKER_ARGUMENT'; end if;
  select coalesce(jsonb_agg(to_jsonb(pending) - 'retry_order' order by pending.retry_order,pending.id),'[]'::jsonb)
  into v_attachments from (
    select a.id,a.message_id,a.mime_type,a.created_at,coalesce(a.ai_last_attempt_at,a.created_at) as retry_order
    from public.broker_attachments a
    join public.broker_messages m on m.id=a.message_id and m.company_id=a.company_id
    where a.company_id=p_company_id and m.gmail_connection_id=p_connection_id
      and m.status<>'needs_review'
      and a.mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/gif')
      and (a.ai_last_attempt_at is null or a.ai_last_attempt_at<=clock_timestamp()-interval '30 minutes')
      and not exists (
        select 1 from public.ai_extractions e
        where e.company_id=p_company_id and e.message_id=a.message_id and e.attachment_id=a.id
          and (e.status in ('extracted','needs_review') or
            (e.status='parse_failed' and e.processed_at>clock_timestamp()-interval '30 minutes'))
      )
    order by coalesce(a.ai_last_attempt_at,a.created_at),a.id limit p_limit
  ) pending;
  return jsonb_build_object('status','selected','attachments',v_attachments);
end;
$$;
revoke all on function public.recover_gmail_cloud_label_jobs(uuid,uuid,uuid,bigint,integer) from public,anon,authenticated;
revoke all on function public.select_gmail_cloud_pending_attachments(uuid,uuid,uuid,bigint,integer) from public,anon,authenticated;
grant execute on function public.recover_gmail_cloud_label_jobs(uuid,uuid,uuid,bigint,integer) to service_role;
grant execute on function public.select_gmail_cloud_pending_attachments(uuid,uuid,uuid,bigint,integer) to service_role;
