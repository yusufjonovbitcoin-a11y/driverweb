-- Only the Edge service can write raw_extraction. The authenticated RPC consumes
-- that server snapshot, creates the draft, and links it in the same transaction.
-- A lost HTTP response is safe: retry returns the already linked draft.
create function public.create_document_import_draft(target_import_id uuid, expected_checksum text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor public.profiles := public.current_profile(); imported public.manual_load_imports;
  draft jsonb; created_id uuid;
begin
  if auth.uid() is null or actor.id is null or actor.status <> 'active'
    or actor.role not in ('company_admin','dispatcher') then raise exception 'Dispatcher permission required'; end if;
  select * into imported from public.manual_load_imports where id=target_import_id for update;
  if imported.id is null or imported.company_id is distinct from actor.company_id
    or imported.checksum_sha256 is distinct from expected_checksum then raise exception 'Import not found'; end if;
  if imported.load_id is not null then
    if not public.can_access_load(imported.load_id) then raise exception 'Load not found'; end if;
    return imported.load_id;
  end if;
  draft := imported.raw_extraction->'draft';
  if imported.status <> 'processing' or jsonb_typeof(draft) is distinct from 'object'
    or nullif(draft->>'load_number','') is null then raise exception 'Prepared import draft is missing'; end if;
  created_id := public.create_load_draft(
    draft->>'load_number', draft->>'broker_name', draft->>'cargo_description', draft->>'equipment_type',
    (draft->>'weight_lbs')::integer, (draft->>'broker_rate')::numeric, (draft->>'loaded_miles')::numeric,
    draft->'pickup', draft->'delivery', nullif(draft->>'broker_message_id','')::uuid);
  update public.manual_load_imports set load_id=created_id where id=imported.id;
  return created_id;
end $$;
revoke all on function public.create_document_import_draft(uuid,text) from public,anon;
grant execute on function public.create_document_import_draft(uuid,text) to authenticated;
