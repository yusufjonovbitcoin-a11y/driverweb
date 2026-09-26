create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null check (
    document_type in (
      'registration',
      'ifta',
      'medical_certificate',
      'insurance',
      'other'
    )
  ),
  file_name text not null,
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists driver_documents_driver_created_idx
  on public.driver_documents(driver_id, created_at desc);

alter table public.driver_documents enable row level security;

drop policy if exists driver_documents_read on public.driver_documents;
create policy driver_documents_read
on public.driver_documents for select to authenticated
using (
  company_id = public.current_company_id()
  and public.can_access_driver(driver_id)
);

revoke all on public.driver_documents from anon, authenticated;
grant select on public.driver_documents to authenticated;

create or replace function public.update_my_truck_profile(
  p_unit_number text,
  p_vehicle_make text,
  p_vehicle_model text,
  p_vehicle_year integer,
  p_vin text,
  p_license_plate text,
  p_current_mileage integer,
  p_dot_number text,
  p_mc_number text
)
returns public.driver_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  result public.driver_profiles;
begin
  if actor.id is null or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;
  if p_vehicle_year is not null and p_vehicle_year not between 1900 and 2200 then
    raise exception 'Vehicle year is invalid';
  end if;
  if p_current_mileage is not null and p_current_mileage < 0 then
    raise exception 'Mileage cannot be negative';
  end if;

  update public.driver_profiles
  set
    unit_number = nullif(trim(p_unit_number), ''),
    vehicle_make = nullif(trim(p_vehicle_make), ''),
    vehicle_model = nullif(trim(p_vehicle_model), ''),
    vehicle_year = p_vehicle_year,
    vin = nullif(upper(trim(p_vin)), ''),
    license_plate = nullif(upper(trim(p_license_plate)), ''),
    current_mileage = p_current_mileage,
    dot_number = nullif(trim(p_dot_number), ''),
    mc_number = nullif(trim(p_mc_number), ''),
    updated_at = now()
  where user_id = actor.id and company_id = actor.company_id
  returning * into result;

  if result.user_id is null then
    raise exception 'Driver profile not found';
  end if;

  insert into public.audit_events(
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    new_value
  ) values (
    actor.company_id,
    actor.id,
    'driver.truck_profile_updated',
    'driver_profile',
    actor.id,
    jsonb_build_object(
      'unitNumber', result.unit_number,
      'vehicleMake', result.vehicle_make,
      'vehicleModel', result.vehicle_model,
      'vehicleYear', result.vehicle_year,
      'licensePlate', result.license_plate,
      'currentMileage', result.current_mileage
    )
  );

  return result;
end;
$$;

create or replace function public.save_my_driver_document(
  p_document_type text,
  p_file_name text,
  p_mime_type text,
  p_storage_path text,
  p_size_bytes bigint
)
returns public.driver_documents
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor public.profiles := public.current_profile();
  expected_prefix text;
  result public.driver_documents;
begin
  if actor.id is null or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;
  if p_document_type not in (
    'registration',
    'ifta',
    'medical_certificate',
    'insurance',
    'other'
  ) then
    raise exception 'Unsupported driver document type';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Only image documents are supported';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'Document image must be between 1 byte and 10 MB';
  end if;

  expected_prefix := actor.company_id::text || '/' || actor.id::text || '/documents/';
  if p_storage_path is null or p_storage_path not like expected_prefix || '%' then
    raise exception 'Invalid driver document path';
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'profile-media' and name = p_storage_path
  ) then
    raise exception 'Uploaded driver document was not found';
  end if;

  insert into public.driver_documents(
    company_id,
    driver_id,
    document_type,
    file_name,
    mime_type,
    storage_path,
    size_bytes
  ) values (
    actor.company_id,
    actor.id,
    p_document_type,
    trim(p_file_name),
    p_mime_type,
    p_storage_path,
    p_size_bytes
  ) returning * into result;

  insert into public.audit_events(
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    new_value
  ) values (
    actor.company_id,
    actor.id,
    'driver.document_uploaded',
    'driver_document',
    result.id,
    jsonb_build_object('documentType', result.document_type)
  );

  return result;
end;
$$;

create or replace function public.delete_my_driver_document(
  p_document_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target public.driver_documents;
begin
  if actor.id is null or actor.role <> 'driver' then
    raise exception 'Driver permission required';
  end if;

  select * into target
  from public.driver_documents
  where id = p_document_id
    and driver_id = actor.id
    and company_id = actor.company_id
  for update;

  if target.id is null then
    raise exception 'Driver document not found';
  end if;

  delete from public.driver_documents where id = target.id;

  insert into public.audit_events(
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value
  ) values (
    actor.company_id,
    actor.id,
    'driver.document_deleted',
    'driver_document',
    target.id,
    to_jsonb(target)
  );

  return target.storage_path;
end;
$$;

revoke all on function public.update_my_truck_profile(
  text, text, text, integer, text, text, integer, text, text
) from public, anon;
revoke all on function public.save_my_driver_document(
  text, text, text, text, bigint
) from public, anon;
revoke all on function public.delete_my_driver_document(uuid) from public, anon;

grant execute on function public.update_my_truck_profile(
  text, text, text, integer, text, text, integer, text, text
) to authenticated;
grant execute on function public.save_my_driver_document(
  text, text, text, text, bigint
) to authenticated;
grant execute on function public.delete_my_driver_document(uuid) to authenticated;
