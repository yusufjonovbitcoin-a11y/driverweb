-- Warning rows carry semantic codes and interpolation parameters. Presentation
-- copy is selected by each client locale and is never persisted as business data.
alter table public.warnings
  alter column message drop not null,
  add column if not exists params jsonb not null default '{}'::jsonb;

-- Recover semantic field identifiers from historic AI-import warnings before
-- deleting localized presentation copy. Prefer the structured check result and
-- only use the legacy sentence shape when the result is unavailable.
with ranked_warnings as (
  select
    w.id,
    w.document_check_id,
    w.message,
    row_number() over (
      partition by w.document_check_id order by w.created_at, w.id
    ) as position
  from public.warnings w
  where w.code = 'ai_missing_field'
), ranked_fields as (
  select
    c.id as document_check_id,
    field.value as field,
    field.ordinality as position
  from public.document_checks c
  cross join lateral jsonb_array_elements_text(
    coalesce(c.result->'missingFields', '[]'::jsonb)
  ) with ordinality as field(value, ordinality)
), backfill as (
  select
    rw.id,
    coalesce(
      rf.field,
      substring(rw.message from '^AI hujjatdan (.+) maydonini aniq topa olmadi[.]$')
    ) as field
  from ranked_warnings rw
  left join ranked_fields rf
    on rf.document_check_id = rw.document_check_id
   and rf.position = rw.position
)
update public.warnings w
set params = jsonb_build_object('field', backfill.field)
from backfill
where w.id = backfill.id
  and backfill.field is not null
  and w.params = '{}'::jsonb;

update public.warnings set message = null where message is not null;

create or replace view public.document_review_overview
with (security_invoker = true)
as
select
  d.id as document_id,
  d.load_id,
  d.document_type,
  d.current_version_id,
  c.id as check_id,
  c.status as check_status,
  c.confidence as check_confidence,
  c.model_name as check_model_name,
  c.result as check_result,
  c.checked_at,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', w.id,
        'code', w.code,
        'params', w.params
      ) order by w.created_at
    ) filter (where w.id is not null and w.is_active),
    '[]'::jsonb
  ) as active_warnings
from public.documents d
left join public.document_checks c on c.document_version_id = d.current_version_id
left join public.warnings w on w.document_check_id = c.id
group by d.id, d.load_id, d.document_type, d.current_version_id,
  c.id, c.status, c.confidence, c.model_name, c.result, c.checked_at;

grant select on public.document_review_overview to authenticated;

create or replace function public.record_document_check(
  check_id uuid,
  next_status public.document_check_status,
  confidence numeric,
  model_name text,
  result jsonb,
  warnings jsonb default '[]'::jsonb
)
returns public.document_checks
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.document_checks;
  target_load_id uuid;
  warning jsonb;
begin
  update public.document_checks set
    status = next_status,
    confidence = record_document_check.confidence,
    model_name = record_document_check.model_name,
    result = record_document_check.result,
    checked_at = now()
  where id = check_id and status in ('queued', 'checking', 'warning', 'failed_to_read')
  returning * into saved;
  if saved.id is null then raise exception 'Document check not found'; end if;

  select d.load_id into target_load_id
  from public.document_versions v
  join public.documents d on d.id = v.document_id
  where v.id = saved.document_version_id;

  update public.warnings set is_active = false
  where document_check_id = saved.id and is_active;

  for warning in select * from jsonb_array_elements(coalesce(warnings, '[]'::jsonb)) loop
    insert into public.warnings(
      company_id, load_id, document_check_id, code, message, params
    ) values (
      saved.company_id,
      target_load_id,
      saved.id,
      warning->>'code',
      null,
      coalesce(warning->'params', '{}'::jsonb)
    );
  end loop;

  insert into public.audit_events(company_id, action, entity_type, entity_id, new_value, metadata)
  values (
    saved.company_id,
    'document.ai_checked',
    'document_check',
    saved.id,
    to_jsonb(saved),
    jsonb_build_object('source', 'worker')
  );
  return saved;
end;
$$;

revoke all on function public.record_document_check(
  uuid, public.document_check_status, numeric, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.record_document_check(
  uuid, public.document_check_status, numeric, text, jsonb, jsonb
) to service_role;
