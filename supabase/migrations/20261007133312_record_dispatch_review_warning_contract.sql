-- Sending is the dispatcher's acknowledgement of the visible document warnings.
-- Keep the warning list for audit, while the reviewed driver brief remains
-- compatible with the mobile app and the assignment trigger.
create or replace function public.review_and_assign_document_load(
  target_load_id uuid, target_driver_id uuid, source_checksum text
)
returns public.assignments language plpgsql security definer set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.loads;
  imported public.manual_load_imports;
  reviewed_brief jsonb;
  warning_fields jsonb;
begin
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  select * into target from public.loads l
  where l.id = target_load_id and l.company_id = actor.company_id for update;
  if target.id is null then raise exception 'Load not found'; end if;
  select * into imported from public.manual_load_imports i
  where i.load_id = target.id and i.company_id = actor.company_id
    and i.checksum_sha256 = source_checksum and i.extraction_schema_version >= 3
    and i.status in ('needs_review', 'extracted')
  for update;
  if imported.id is null or target.driver_brief is null
      or target.driver_brief->>'checksum' is distinct from source_checksum then
    raise exception 'Document review is stale. Upload the source again';
  end if;
  if jsonb_typeof(target.driver_brief->'fields') is distinct from 'array'
      or jsonb_array_length(target.driver_brief->'fields') = 0
      or jsonb_typeof(target.driver_brief->'blockingFields') is distinct from 'array' then
    raise exception 'Driver sheet is unavailable';
  end if;
  select coalesce(jsonb_agg(to_jsonb(field) order by field), '[]'::jsonb)
    into warning_fields
  from (
    select distinct value as field
    from jsonb_array_elements_text(
      (case when jsonb_typeof(imported.extracted_result#>'{review,warningFields}') = 'array'
        then imported.extracted_result#>'{review,warningFields}' else '[]'::jsonb end)
      || (target.driver_brief->'blockingFields')
    ) as warning(value)
  ) as distinct_warnings;
  reviewed_brief := target.driver_brief || jsonb_build_object(
    'reviewedAt', now(), 'reviewedBy', actor.id,
    'blockingFields', '[]'::jsonb, 'warningFields', warning_fields);
  update public.loads set driver_brief = reviewed_brief where id = target.id;
  update public.manual_load_imports set status = 'extracted',
    extracted_result = imported.extracted_result || jsonb_build_object(
      'driverBrief', reviewed_brief,
      'review', coalesce(imported.extracted_result->'review', '{}'::jsonb) || jsonb_build_object(
        'required', false, 'checksum', source_checksum,
        'blockingFields', '[]'::jsonb, 'warningFields', warning_fields))
  where id = imported.id;
  if target.status in ('draft', 'review') then perform public.approve_load_draft(target.id); end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values(actor.company_id, actor.id, 'load.driver_brief_reviewed', 'load', target.id,
    jsonb_build_object('importId', imported.id, 'checksum', source_checksum,
      'warningFields', warning_fields));
  -- Review, approval and assignment remain atomic; a failed assignment rolls
  -- back the reviewed flag and leaves the draft recoverable.
  return public.assign_load_directly(target.id, target_driver_id);
end;
$$;
revoke all on function public.review_and_assign_document_load(uuid, uuid, text) from public, anon;
grant execute on function public.review_and_assign_document_load(uuid, uuid, text) to authenticated;
