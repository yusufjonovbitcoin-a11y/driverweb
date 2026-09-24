-- Allow a privileged dispatcher to refresh non-price facts from the immutable
-- original document without replacing an active load or creating a duplicate.

create or replace function public.refresh_ai_import_metadata(
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
  active_assignment public.assignments;
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
    end,
    version = l.version + 1
  where l.id = target_load_id
    and l.company_id = actor.company_id
    and l.status not in ('completed', 'cancelled')
  returning l.* into saved;

  if saved.id is null then raise exception 'Active load not found'; end if;

  update public.load_stops s set
    contact_name = nullif(trim(pickup_details->>'contactName'), ''),
    contact_phone = nullif(trim(pickup_details->>'contactPhone'), ''),
    contact_source = case
      when nullif(trim(pickup_details->>'contactName'), '') is not null
        or nullif(trim(pickup_details->>'contactPhone'), '') is not null
      then 'broker_document' else null end,
    appointment_timezone = coalesce(
      nullif(trim(pickup_details->>'appointmentTimezone'), ''),
      s.appointment_timezone
    ),
    version = s.version + 1
  where s.load_id = target_load_id and s.company_id = actor.company_id and s.type = 'pickup';

  update public.load_stops s set
    contact_name = nullif(trim(delivery_details->>'contactName'), ''),
    contact_phone = nullif(trim(delivery_details->>'contactPhone'), ''),
    contact_source = case
      when nullif(trim(delivery_details->>'contactName'), '') is not null
        or nullif(trim(delivery_details->>'contactPhone'), '') is not null
      then 'broker_document' else null end,
    appointment_timezone = coalesce(
      nullif(trim(delivery_details->>'appointmentTimezone'), ''),
      s.appointment_timezone
    ),
    version = s.version + 1
  where s.load_id = target_load_id and s.company_id = actor.company_id and s.type = 'delivery';

  if saved.current_assignment_id is not null then
    update public.assignments set
      requires_reconfirmation = true,
      reconfirmed_at = null
    where id = saved.current_assignment_id and status = 'active'
    returning * into active_assignment;

    if active_assignment.id is not null then
      insert into public.notifications(
        company_id, recipient_id, type, title, body, entity_type, entity_id
      ) values (
        actor.company_id,
        active_assignment.driver_id,
        'terms_changed',
        'Load details refreshed',
        'AI hujjatdan yuk talablari va kontaktlarni yangiladi. Ma’lumotni ko‘rib tasdiqlang.',
        'load',
        saved.id
      );
    end if;
  end if;

  insert into public.audit_events(
    company_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    actor.company_id,
    actor.id,
    'load.ai_metadata_refreshed',
    'load',
    saved.id,
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

revoke all on function public.refresh_ai_import_metadata(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.refresh_ai_import_metadata(uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

-- Appointment warnings from the old parser are stale after migration 004
-- repaired the corresponding stop timestamps.
update public.warnings w set is_active = false
where w.is_active
  and w.code = 'ai_missing_field'
  and (
    (lower(w.message) like '%pickup%appointment%' and exists (
      select 1 from public.load_stops s
      where s.load_id = w.load_id and s.type = 'pickup' and s.appointment_from is not null
    ))
    or
    (lower(w.message) like '%delivery%appointment%' and exists (
      select 1 from public.load_stops s
      where s.load_id = w.load_id and s.type = 'delivery' and s.appointment_from is not null
    ))
  );

