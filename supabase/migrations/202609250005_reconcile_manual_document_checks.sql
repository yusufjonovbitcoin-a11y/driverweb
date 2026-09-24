-- Reconcile manual imports created before the inline document check existed.
-- Their extraction already reviewed the exact original file, so reuse that
-- result instead of paying for a duplicate model call.

create temporary table reconciled_manual_checks on commit drop as
select
  c.id as check_id,
  c.company_id,
  d.load_id,
  v.id as version_id,
  i.model_name,
  i.extracted_result,
  coalesce(i.extracted_result->'missingFields', '[]'::jsonb) as missing_fields,
  case
    when jsonb_typeof(i.extracted_result->'missingFields') = 'array'
      and jsonb_array_length(i.extracted_result->'missingFields') > 0
    then 'warning'::public.document_check_status
    else 'passed'::public.document_check_status
  end as next_status
from public.manual_load_imports i
join public.documents d
  on d.load_id = i.load_id and d.document_type = 'rate_confirmation'
join public.document_versions v on v.id = d.current_version_id
join public.document_checks c on c.document_version_id = v.id
where c.status = 'queued';

update public.document_checks c set
  status = r.next_status,
  confidence = case
    when jsonb_typeof(r.extracted_result->'confidence') = 'number'
      then (r.extracted_result->>'confidence')::numeric
    else null
  end,
  model_name = r.model_name,
  result = jsonb_build_object(
    'source', 'manual_load_import',
    'missingFields', r.missing_fields
  ),
  checked_at = now()
from reconciled_manual_checks r
where c.id = r.check_id;

insert into public.warnings(
  company_id, load_id, document_check_id, code, message
)
select
  r.company_id,
  r.load_id,
  r.check_id,
  'ai_missing_field',
  'AI hujjatdan ' || field.value || ' maydonini aniq topa olmadi.'
from reconciled_manual_checks r
cross join lateral jsonb_array_elements_text(r.missing_fields) field(value)
where not exists (
  select 1 from public.warnings w
  where w.document_check_id = r.check_id
    and w.code = 'ai_missing_field'
    and w.message = 'AI hujjatdan ' || field.value || ' maydonini aniq topa olmadi.'
);

update public.jobs j set
  status = 'completed',
  locked_at = null,
  locked_by = null,
  last_error = null
from reconciled_manual_checks r
where j.idempotency_key = 'document-check:' || r.version_id::text;

insert into public.audit_events(
  company_id, action, entity_type, entity_id, new_value, metadata
)
select
  r.company_id,
  'document.ai_check_reconciled',
  'document_check',
  r.check_id,
  jsonb_build_object('status', r.next_status, 'missingFields', r.missing_fields),
  jsonb_build_object('migration', '202609250005_reconcile_manual_document_checks')
from reconciled_manual_checks r;

