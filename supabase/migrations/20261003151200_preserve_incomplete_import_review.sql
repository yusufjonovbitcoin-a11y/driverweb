-- Preserve incomplete imports for review, without making them dispatchable.
-- Service-only permissions, tenant checks and assignment locks remain unchanged.
create or replace function public.refresh_verified_import_draft(
  target_import_id uuid, actor_id uuid, expected_checksum text,
  extraction jsonb, verified_brief jsonb, raw_snapshot jsonb
)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare
  imported public.manual_load_imports;
  target public.loads;
  actor public.profiles;
  stop_json jsonb;
  role_name text;
begin
  select * into actor from public.profiles p where p.id = actor_id;
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  -- Same load-first lock order as review_and_assign_document_load.
  select l.* into target from public.loads l join public.manual_load_imports i on i.load_id = l.id
    where i.id = target_import_id and l.company_id = actor.company_id for update of l;
  select * into imported from public.manual_load_imports i where i.id = target_import_id for update;
  if target.id is null or imported.company_id is distinct from actor.company_id
    or imported.checksum_sha256 is distinct from expected_checksum
    or verified_brief->>'checksum' is distinct from expected_checksum
    or nullif(target.driver_brief->>'reviewedAt','') is not null
    or target.status not in ('draft','review') or target.current_assignment_id is not null
    or exists(select 1 from public.assignments a where a.load_id = target.id)
    or exists(select 1 from public.offers o where o.load_id = target.id) then
    raise exception 'Only an unassigned import can be reanalysed';
  end if;
  if jsonb_typeof(verified_brief->'fields') <> 'array' or nullif(verified_brief->>'reviewedAt','') is not null then
    raise exception 'Unreviewed verified brief required';
  end if;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value)
    values(actor.company_id,actor.id,'load.import_reanalysed','load',target.id,
      jsonb_build_object('load',to_jsonb(target),'extraction',imported.raw_extraction,'schemaVersion',imported.extraction_schema_version));
  update public.loads set
    load_number = coalesce(nullif(extraction->>'loadNumber',''),load_number),
    broker_name = extraction#>>'{broker,name}', cargo_description = extraction->>'cargoDescription',
    equipment_type = extraction->>'equipmentType', weight_lbs = (extraction->>'weightLbs')::integer,
    broker_rate = coalesce((extraction->>'brokerRate')::numeric,0),
    loaded_miles = coalesce((extraction->>'loadedMiles')::numeric,0),
    broker_reported_miles = (extraction->>'loadedMiles')::numeric,
    driver_brief = verified_brief, route_distance_miles = null, route_duration_seconds = null,
    route_provider = null, route_calculated_at = null, version = version + 1
    where id = target.id;
  foreach role_name in array array['pickup','delivery'] loop
    stop_json := extraction->role_name;
    if nullif(stop_json->>'city','') is null or nullif(stop_json->>'region','') is null then
      raise exception 'Verified city and region required';
    end if;
    if nullif(stop_json->>'addressLine','') is null and (
      jsonb_typeof(verified_brief->'blockingFields') is distinct from 'array'
      or not coalesce((verified_brief->'blockingFields') ? (role_name || '.addressLine'),false)
    ) then raise exception 'Missing address must block dispatch'; end if;
    update public.load_stops set facility_name = stop_json->>'facilityName',
      address_line = coalesce(stop_json->>'addressLine',''), city = stop_json->>'city', region = stop_json->>'region',
      postal_code = stop_json->>'postalCode', latitude = null, longitude = null,
      contact_place_id = null, appointment_from = (stop_json->>'appointmentFrom')::timestamptz,
      appointment_to = (stop_json->>'appointmentTo')::timestamptz,
      appointment_timezone = stop_json->>'appointmentTimezone', version = version + 1
      where load_id = target.id and type::text = role_name;
  end loop;
  update public.manual_load_imports set raw_extraction = raw_snapshot, extraction_schema_version = 4,
    extracted_result = null where id = imported.id;
  return target.id;
end;
$$;
revoke all on function public.refresh_verified_import_draft(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.refresh_verified_import_draft(uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
