-- Service-only, staff-scoped and locked against assignment. Existing stop IDs survive.
create or replace function public.save_import_ordered_stops(
  target_import_id uuid, actor_id uuid, expected_checksum text, ordered_stops jsonb
) returns void language plpgsql security invoker set search_path=public as $$
declare
  actor public.profiles; target public.loads; imported public.manual_load_imports;
  item jsonb; n integer := 0;
begin
  select * into actor from public.profiles where id=actor_id;
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin','dispatcher') then
    raise exception 'Dispatcher permission required'; end if;
  select l.* into target from public.loads l join public.manual_load_imports i on i.load_id=l.id
    where i.id=target_import_id and l.company_id=actor.company_id for update of l;
  select * into imported from public.manual_load_imports where id=target_import_id for update;
  if target.id is null or imported.company_id is distinct from actor.company_id
    or imported.checksum_sha256 is distinct from expected_checksum
    or target.status not in ('draft','review') or target.current_assignment_id is not null
    or nullif(target.driver_brief->>'reviewedAt','') is not null
    or exists(select 1 from public.assignments where load_id=target.id)
    or exists(select 1 from public.offers where load_id=target.id) then
    raise exception 'Only an unassigned import can be changed'; end if;
  if jsonb_typeof(ordered_stops) is distinct from 'array' or jsonb_array_length(ordered_stops) not between 2 and 25
    or ordered_stops->0->>'role' is distinct from 'pickup'
    or ordered_stops->-1->>'role' is distinct from 'delivery' then raise exception 'Invalid ordered stops'; end if;
  if exists(select 1 from public.load_stops where load_id=target.id and sequence>jsonb_array_length(ordered_stops)) then
    raise exception 'Existing stops must not be silently removed'; end if;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,old_value,new_value)
    values(actor.company_id,actor.id,'load.import_stops_updated','load',target.id,
      (select jsonb_agg(to_jsonb(s) order by sequence) from public.load_stops s where load_id=target.id),ordered_stops);
  for item in select value from jsonb_array_elements(ordered_stops) loop
    n:=n+1;
    if item->>'role' not in ('pickup','delivery') or item->>'role' is null then raise exception 'Invalid stop role'; end if;
    insert into public.load_stops(company_id,load_id,type,sequence,facility_name,address_line,city,region,postal_code,
      contact_name,contact_phone,contact_source,appointment_from,appointment_to,appointment_timezone,requires_document)
    values(actor.company_id,target.id,(item->>'role')::public.stop_type,n,item->>'facilityName',coalesce(item->>'addressLine',''),
      coalesce(item->>'city',''),coalesce(item->>'region',''),item->>'postalCode',item->>'contactName',item->>'contactPhone',
      case when item->>'contactPhone' is null then null else 'broker_document' end,
      nullif(item->>'appointmentFrom','')::timestamptz,nullif(item->>'appointmentTo','')::timestamptz,item->>'appointmentTimezone',true)
    on conflict(load_id,sequence) do update set type=excluded.type,facility_name=excluded.facility_name,
      address_line=excluded.address_line,city=excluded.city,region=excluded.region,postal_code=excluded.postal_code,
      contact_name=excluded.contact_name,contact_phone=excluded.contact_phone,contact_source=excluded.contact_source,
      contact_place_id=null,latitude=null,longitude=null,appointment_from=excluded.appointment_from,
      appointment_to=excluded.appointment_to,appointment_timezone=excluded.appointment_timezone,version=load_stops.version+1;
  end loop;
end; $$;
revoke all on function public.save_import_ordered_stops(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_import_ordered_stops(uuid,uuid,text,jsonb) to service_role;
