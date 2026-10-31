-- Collapse remote database round trips without moving persistence before Send.
-- Only the verified Edge handler can write raw_extraction.confirmation.
create function public.prepare_import_assignment_upload(p_import_id uuid, p_expected_checksum text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles := public.current_profile(); imported public.manual_load_imports;
  snapshot jsonb; target_id uuid; plan jsonb;
begin
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'IMPORT_DOCUMENT_PERMISSION_DENIED'; end if;
  -- Consistent load -> import lock order, including a replay of this command.
  perform l.id from public.loads l join public.manual_load_imports i on i.load_id=l.id
    where i.id=p_import_id and i.company_id=actor.company_id and i.created_by=actor.id
      and l.company_id=actor.company_id for update of l;
  select * into imported from public.manual_load_imports where id=p_import_id for update;
  snapshot := imported.raw_extraction->'confirmation';
  if imported.id is null or imported.created_by is distinct from actor.id
    or imported.company_id is distinct from actor.company_id or imported.status <> 'processing'
    or imported.checksum_sha256 is distinct from p_expected_checksum
    or p_expected_checksum is null or p_expected_checksum !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(snapshot) is distinct from 'object'
    or snapshot#>>'{driverBrief,checksum}' is distinct from p_expected_checksum
    or snapshot#>>'{review,checksum}' is distinct from p_expected_checksum
    or nullif(snapshot#>>'{driverBrief,reviewedAt}','') is not null then
    raise exception 'IMPORT_CONFIRMATION_SNAPSHOT_INVALID'; end if;
  target_id := public.create_document_import_draft(imported.id,p_expected_checksum);
  if not exists(select 1 from public.loads where id=target_id and company_id=actor.company_id
    and status in ('draft','review') and current_assignment_id is null
    and nullif(driver_brief->>'reviewedAt','') is null) then
    raise exception 'IMPORT_DOCUMENT_CONFLICT'; end if;
  update public.loads set driver_brief=snapshot->'driverBrief' where id=target_id;
  perform public.apply_ai_import_metadata(target_id,
    jsonb_build_object('name',snapshot->'brokerContact','phone',snapshot->'brokerPhone',
      'email',snapshot->'brokerEmail','fax',snapshot->'brokerFax'),
    jsonb_build_object('mode',snapshot->'freightMode','temperatureFahrenheit',snapshot->'temperatureFahrenheit',
      'palletCount',snapshot->'palletCount','caseCount',snapshot->'caseCount','isHazmat',snapshot->'isHazmat',
      'specialInstructions',snapshot->'specialInstructions','requirements',snapshot->'requirements'),
    jsonb_build_object('contactName',snapshot#>'{origin,contactName}','contactPhone',snapshot#>'{origin,contactPhone}',
      'appointmentTimezone',snapshot#>'{origin,appointmentTimezone}'),
    jsonb_build_object('contactName',snapshot#>'{destination,contactName}','contactPhone',snapshot#>'{destination,contactPhone}',
      'appointmentTimezone',snapshot#>'{destination,appointmentTimezone}'));
  perform public.save_import_ordered_stops(imported.id,actor.id,p_expected_checksum,snapshot->'stops');
  plan := public.begin_import_document_upload(imported.id,p_expected_checksum);
  return plan || jsonb_build_object('loadId',target_id);
end $$;
revoke all on function public.prepare_import_assignment_upload(uuid,text) from public,anon,service_role;
grant execute on function public.prepare_import_assignment_upload(uuid,text) to authenticated;

-- The browser cannot attest a checksum. Storage completion and the verified
-- snapshot remain service-only, before the caller's atomic review/assignment.
create function public.finalize_import_assignment_source(p_import_id uuid,p_version_id uuid,
  p_expected_checksum text,p_actor_id uuid,p_model text)
returns public.documents language plpgsql security invoker set search_path='' as $$
declare imported public.manual_load_imports; document public.documents; snapshot jsonb;
  check_id uuid; check_warnings jsonb;
begin
  document := public.complete_import_document_upload(p_import_id,p_version_id,p_expected_checksum,p_actor_id);
  select * into imported from public.manual_load_imports where id=p_import_id for update;
  snapshot := imported.raw_extraction->'confirmation';
  if imported.created_by is distinct from p_actor_id or imported.load_id is distinct from document.load_id
    or imported.checksum_sha256 is distinct from p_expected_checksum
    or jsonb_typeof(snapshot) is distinct from 'object'
    or snapshot#>>'{driverBrief,checksum}' is distinct from p_expected_checksum then
    raise exception 'IMPORT_CONFIRMATION_SNAPSHOT_INVALID'; end if;
  snapshot := snapshot || jsonb_build_object('id',document.load_id);
  select id into check_id from public.document_checks where document_version_id=p_version_id
    order by created_at desc limit 1;
  if check_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('code','ai_missing_field','field',field,
      'params',jsonb_build_object('field',field))),'[]'::jsonb) into check_warnings
      from jsonb_array_elements_text(coalesce(snapshot->'missingFields','[]'::jsonb)) as item(field);
    perform public.record_document_check(check_id,'warning',0,p_model,
      jsonb_build_object('source','load_import','loadNumber',snapshot->'loadNumber',
        'missingFields',snapshot->'missingFields','reviewRequired',true,
        'verificationMethod','single_pass_rules','independentAudit',false),check_warnings);
    update public.jobs set status='completed',last_error=null where idempotency_key='document-check:'||p_version_id;
  end if;
  update public.manual_load_imports set status='needs_review',model_name=p_model,
    extracted_result=snapshot,error_message=null,
    raw_extraction=raw_extraction-'confirmation'
    where id=imported.id;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(imported.company_id,p_actor_id,'load.ai_imported','load',document.load_id,
      jsonb_build_object('importId',imported.id,'model',p_model,'confidence',snapshot->'confidence'));
  return document;
end $$;
revoke all on function public.finalize_import_assignment_source(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_import_assignment_source(uuid,uuid,text,uuid,text) to service_role;
