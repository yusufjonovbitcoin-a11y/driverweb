-- Original-backed driver sheets. Existing loads are unaffected.
alter table public.loads add column driver_brief jsonb;

-- Append the field without changing the read model's existing column contract.
do $$
declare existing_definition text := pg_get_viewdef('public.load_overview'::regclass, true);
begin
  execute 'create or replace view public.load_overview with (security_invoker = true) as '
    || 'select existing.*, source.driver_brief from (' || rtrim(existing_definition, E';\n ')
    || ') existing join public.loads source on source.id = existing.id';
end;
$$;

create or replace function public.guard_driver_brief_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare brief jsonb;
begin
  select l.driver_brief into brief from public.loads l where l.id = new.load_id for update;
  if brief is not null and (nullif(brief->>'reviewedAt', '') is null
      or jsonb_array_length(coalesce(brief->'blockingFields', '[]'::jsonb)) > 0) then
    raise exception 'Document review required before assignment';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_driver_brief_assignment() from public, anon, authenticated;
create trigger assignments_driver_brief_guard before insert or update of load_id on public.assignments
for each row execute function public.guard_driver_brief_assignment();
create trigger offers_driver_brief_guard before insert or update of load_id on public.offers
for each row execute function public.guard_driver_brief_assignment();

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
      or jsonb_typeof(target.driver_brief->'blockingFields') is distinct from 'array'
      or jsonb_array_length(target.driver_brief->'blockingFields') > 0 then
    raise exception 'Document has unresolved fields. Upload a clearer complete source';
  end if;
  reviewed_brief := target.driver_brief || jsonb_build_object('reviewedAt', now(), 'reviewedBy', actor.id);
  update public.loads set driver_brief = reviewed_brief where id = target.id;
  update public.manual_load_imports set status = 'extracted',
    extracted_result = extracted_result || jsonb_build_object('driverBrief', reviewed_brief,
      'review', jsonb_build_object('required', false, 'checksum', source_checksum, 'blockingFields', '[]'::jsonb))
  where id = imported.id;
  if target.status in ('draft', 'review') then perform public.approve_load_draft(target.id); end if;
  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values(actor.company_id, actor.id, 'load.driver_brief_reviewed', 'load', target.id,
    jsonb_build_object('importId', imported.id, 'checksum', source_checksum));
  -- Review, approval and assignment are one transaction; a failed assignment
  -- cannot leave an unassigned document marked as reviewed.
  return public.assign_load_directly(target.id, target_driver_id);
end;
$$;
revoke all on function public.review_and_assign_document_load(uuid, uuid, text) from public, anon;
grant execute on function public.review_and_assign_document_load(uuid, uuid, text) to authenticated;
