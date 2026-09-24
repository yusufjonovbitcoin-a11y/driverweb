-- Preserve operational facts extracted from load documents and expose a
-- read-only document review model. All writes still pass through commands.

alter table public.loads
  add column if not exists broker_email text,
  add column if not exists broker_fax text,
  add column if not exists freight_mode text,
  add column if not exists temperature_fahrenheit numeric(6,2),
  add column if not exists pallet_count integer check (pallet_count is null or pallet_count >= 0),
  add column if not exists case_count integer check (case_count is null or case_count >= 0),
  add column if not exists is_hazmat boolean,
  add column if not exists special_instructions text,
  add column if not exists load_requirements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(load_requirements) = 'array');

alter table public.load_stops
  add column if not exists appointment_timezone text;

alter table public.manual_load_imports
  add column if not exists raw_extraction jsonb,
  add column if not exists extraction_schema_version integer not null default 1
    check (extraction_schema_version > 0);

create or replace function public.apply_ai_import_metadata(
  target_load_id uuid,
  broker_contact jsonb default '{}'::jsonb,
  freight_details jsonb default '{}'::jsonb,
  pickup_details jsonb default '{}'::jsonb,
  delivery_details jsonb default '{}'::jsonb
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  saved public.loads;
begin
  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;

  update public.loads l set
    broker_contact_name = nullif(trim(broker_contact->>'name'), ''),
    broker_phone = nullif(trim(broker_contact->>'phone'), ''),
    broker_email = nullif(trim(broker_contact->>'email'), ''),
    broker_fax = nullif(trim(broker_contact->>'fax'), ''),
    freight_mode = nullif(trim(freight_details->>'mode'), ''),
    temperature_fahrenheit = case
      when jsonb_typeof(freight_details->'temperatureFahrenheit') = 'number'
        then (freight_details->>'temperatureFahrenheit')::numeric
      else null
    end,
    pallet_count = case
      when jsonb_typeof(freight_details->'palletCount') = 'number'
        then greatest((freight_details->>'palletCount')::integer, 0)
      else null
    end,
    case_count = case
      when jsonb_typeof(freight_details->'caseCount') = 'number'
        then greatest((freight_details->>'caseCount')::integer, 0)
      else null
    end,
    is_hazmat = case
      when jsonb_typeof(freight_details->'isHazmat') = 'boolean'
        then (freight_details->>'isHazmat')::boolean
      else null
    end,
    special_instructions = nullif(trim(freight_details->>'specialInstructions'), ''),
    load_requirements = case
      when jsonb_typeof(freight_details->'requirements') = 'array'
        then freight_details->'requirements'
      else '[]'::jsonb
    end
  where l.id = target_load_id
    and l.company_id = actor.company_id
    and l.status in ('draft', 'review', 'ready_for_offer')
  returning l.* into saved;

  if saved.id is null then
    raise exception 'Editable load draft not found';
  end if;

  update public.load_stops s set
    contact_name = nullif(trim(pickup_details->>'contactName'), ''),
    contact_phone = nullif(trim(pickup_details->>'contactPhone'), ''),
    contact_source = case
      when nullif(trim(pickup_details->>'contactName'), '') is not null
        or nullif(trim(pickup_details->>'contactPhone'), '') is not null
      then 'broker_document'
      else null
    end,
    appointment_timezone = nullif(trim(pickup_details->>'appointmentTimezone'), '')
  where s.load_id = target_load_id and s.company_id = actor.company_id and s.type = 'pickup';

  update public.load_stops s set
    contact_name = nullif(trim(delivery_details->>'contactName'), ''),
    contact_phone = nullif(trim(delivery_details->>'contactPhone'), ''),
    contact_source = case
      when nullif(trim(delivery_details->>'contactName'), '') is not null
        or nullif(trim(delivery_details->>'contactPhone'), '') is not null
      then 'broker_document'
      else null
    end,
    appointment_timezone = nullif(trim(delivery_details->>'appointmentTimezone'), '')
  where s.load_id = target_load_id and s.company_id = actor.company_id and s.type = 'delivery';

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    actor.company_id,
    actor.id,
    'load.ai_metadata_applied',
    'load',
    target_load_id,
    jsonb_build_object(
      'brokerContact', broker_contact,
      'freightDetails', freight_details,
      'pickupDetails', pickup_details,
      'deliveryDetails', delivery_details
    )
  );

  return saved;
end;
$$;

revoke all on function public.apply_ai_import_metadata(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.apply_ai_import_metadata(uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

drop view if exists public.load_overview;

create view public.load_overview
with (security_invoker = true)
as
select
  l.id,
  l.company_id,
  l.load_number,
  l.status,
  l.broker_name,
  l.broker_contact_name,
  l.broker_phone,
  l.broker_email,
  l.broker_fax,
  l.cargo_description,
  l.equipment_type,
  l.freight_mode,
  l.temperature_fahrenheit,
  l.pallet_count,
  l.case_count,
  l.is_hazmat,
  l.special_instructions,
  l.load_requirements,
  l.weight_lbs,
  l.broker_rate,
  l.loaded_miles,
  l.loaded_rpm,
  l.owner_dispatcher_id,
  l.current_assignment_id,
  l.version,
  l.updated_at,
  pickup.facility_name as pickup_facility,
  pickup.city as pickup_city,
  pickup.region as pickup_region,
  pickup.postal_code as pickup_postal_code,
  pickup.appointment_from as pickup_from,
  pickup.appointment_to as pickup_to,
  pickup.appointment_timezone as pickup_timezone,
  pickup.status as pickup_status,
  pickup.contact_name as pickup_contact_name,
  pickup.contact_phone as pickup_contact_phone,
  delivery.facility_name as delivery_facility,
  delivery.city as delivery_city,
  delivery.region as delivery_region,
  delivery.postal_code as delivery_postal_code,
  delivery.appointment_from as delivery_from,
  delivery.appointment_to as delivery_to,
  delivery.appointment_timezone as delivery_timezone,
  delivery.status as delivery_status,
  delivery.contact_name as delivery_contact_name,
  delivery.contact_phone as delivery_contact_phone,
  a.driver_id,
  pickup.address_line as pickup_address,
  pickup.latitude as pickup_latitude,
  pickup.longitude as pickup_longitude,
  delivery.address_line as delivery_address,
  delivery.latitude as delivery_latitude,
  delivery.longitude as delivery_longitude,
  a.requires_reconfirmation
from public.loads l
left join public.load_stops pickup on pickup.load_id = l.id and pickup.type = 'pickup'
left join public.load_stops delivery on delivery.load_id = l.id and delivery.type = 'delivery'
left join public.assignments a on a.id = l.current_assignment_id;

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
      jsonb_build_object('id', w.id, 'code', w.code, 'message', w.message)
      order by w.created_at
    ) filter (where w.id is not null and w.is_active),
    '[]'::jsonb
  ) as active_warnings
from public.documents d
left join public.document_checks c on c.document_version_id = d.current_version_id
left join public.warnings w on w.document_check_id = c.id
group by d.id, d.load_id, d.document_type, d.current_version_id,
  c.id, c.status, c.confidence, c.model_name, c.result, c.checked_at;

grant select on public.load_overview, public.document_review_overview to authenticated;

-- Repair documents imported by the previous parser, which stored a single
-- printed appointment in appointment_to and interpreted the local clock as UTC.
create or replace function public._migration_default_us_timezone(region_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(coalesce(region_code, ''))
    when 'CA' then 'America/Los_Angeles'
    when 'WA' then 'America/Los_Angeles'
    when 'OR' then 'America/Los_Angeles'
    when 'NV' then 'America/Los_Angeles'
    when 'AZ' then 'America/Phoenix'
    when 'CO' then 'America/Denver'
    when 'UT' then 'America/Denver'
    when 'NM' then 'America/Denver'
    when 'WY' then 'America/Denver'
    when 'MT' then 'America/Denver'
    when 'ID' then 'America/Boise'
    when 'TX' then 'America/Chicago'
    when 'OK' then 'America/Chicago'
    when 'KS' then 'America/Chicago'
    when 'NE' then 'America/Chicago'
    when 'SD' then 'America/Chicago'
    when 'ND' then 'America/Chicago'
    when 'MN' then 'America/Chicago'
    when 'IA' then 'America/Chicago'
    when 'MO' then 'America/Chicago'
    when 'AR' then 'America/Chicago'
    when 'LA' then 'America/Chicago'
    when 'WI' then 'America/Chicago'
    when 'IL' then 'America/Chicago'
    when 'MS' then 'America/Chicago'
    when 'AL' then 'America/Chicago'
    when 'TN' then 'America/Chicago'
    when 'AK' then 'America/Anchorage'
    when 'HI' then 'Pacific/Honolulu'
    else 'America/New_York'
  end;
$$;

create temporary table corrected_ai_appointments on commit drop as
select
  s.id as stop_id,
  s.load_id,
  s.company_id,
  s.appointment_to as old_appointment,
  public._migration_default_us_timezone(s.region) as inferred_timezone,
  (
    (s.appointment_to at time zone 'UTC')
    at time zone public._migration_default_us_timezone(s.region)
  ) as corrected_appointment
from public.load_stops s
where s.appointment_from is null
  and s.appointment_to is not null
  and exists (
    select 1 from public.manual_load_imports i where i.load_id = s.load_id
  );

update public.load_stops s set
  appointment_from = c.corrected_appointment,
  appointment_to = null,
  appointment_timezone = c.inferred_timezone,
  version = s.version + 1
from corrected_ai_appointments c
where s.id = c.stop_id;

update public.loads l set version = l.version + 1
where exists (
  select 1 from corrected_ai_appointments c where c.load_id = l.id
);

update public.assignments a set
  requires_reconfirmation = true,
  reconfirmed_at = null
where a.status = 'active'
  and exists (
    select 1
    from public.loads l
    join corrected_ai_appointments c on c.load_id = l.id
    where l.current_assignment_id = a.id
  );

insert into public.notifications(
  company_id, recipient_id, type, title, body, entity_type, entity_id
)
select distinct
  a.company_id,
  a.driver_id,
  'terms_changed',
  'Appointment time corrected',
  'AI importidagi appointment vaqti tuzatildi. Yangilangan vaqtni ko‘rib tasdiqlang.',
  'load',
  a.load_id
from public.assignments a
join corrected_ai_appointments c on c.load_id = a.load_id
where a.status = 'active';

insert into public.audit_events(
  company_id, action, entity_type, entity_id, old_value, new_value, metadata
)
select
  c.company_id,
  'load.ai_appointment_repaired',
  'load',
  c.load_id,
  jsonb_agg(jsonb_build_object('stopId', c.stop_id, 'appointmentTo', c.old_appointment)),
  jsonb_agg(jsonb_build_object(
    'stopId', c.stop_id,
    'appointmentFrom', c.corrected_appointment,
    'timezone', c.inferred_timezone
  )),
  jsonb_build_object('migration', '202609250004_ai_document_intelligence')
from corrected_ai_appointments c
group by c.company_id, c.load_id;

drop function public._migration_default_us_timezone(text);
