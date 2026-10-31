-- Approved business mail filtering must precede LIMIT; preserve the legacy RPC for existing deployments.
create function public.select_gmail_cloud_business_pending_attachments(
  p_company_id uuid, p_owner uuid, p_connection_id uuid,
  p_configuration_version bigint, p_business_senders text[], p_limit integer default 10
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_attachments jsonb;
begin
  v_result := public.assert_gmail_cloud_worker(p_company_id, p_owner,
    p_connection_id, p_configuration_version);
  if v_result->>'status' <> 'valid' then return v_result; end if;
  if (select uid_validity from public.gmail_cloud_worker_controls where company_id=p_company_id) is null then
    return jsonb_build_object('status','uid_validity_unverified','reason','uid_validity_baseline_required');
  end if;
  if p_business_senders is null or cardinality(p_business_senders) not between 1 and 500
    or exists (select 1 from unnest(p_business_senders) sender where sender is null or sender !~ '^[^[:space:]@,<>]+@[^[:space:]@,<>]+\.[^[:space:]@,<>]+$')
    then raise exception 'BUSINESS_POLICY_REQUIRED'; end if;
  if p_limit is null or p_limit not between 1 and 25 then raise exception 'INVALID_WORKER_ARGUMENT'; end if;
  select coalesce(jsonb_agg(to_jsonb(pending) - 'retry_order' order by pending.retry_order,pending.id),'[]'::jsonb)
  into v_attachments from (
    select a.id,a.message_id,a.mime_type,a.created_at,coalesce(a.ai_last_attempt_at,a.created_at) as retry_order
    from public.broker_attachments a
    join public.broker_messages m on m.id=a.message_id and m.company_id=a.company_id
    where a.company_id=p_company_id and m.gmail_connection_id=p_connection_id
      and m.status<>'needs_review'
      and lower(m.from_email) = any(p_business_senders)
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
revoke all on function public.select_gmail_cloud_business_pending_attachments(uuid,uuid,uuid,bigint,text[],integer) from public,anon,authenticated;
grant execute on function public.select_gmail_cloud_business_pending_attachments(uuid,uuid,uuid,bigint,text[],integer) to service_role;
