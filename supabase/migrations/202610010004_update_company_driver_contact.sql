create or replace function public.update_company_driver_contact(
  p_driver_id uuid,
  p_full_name text,
  p_phone text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  previous public.profiles;
  updated public.profiles;
  cleaned_name text := btrim(coalesce(p_full_name, ''));
  cleaned_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if actor.id is null or actor.status <> 'active' or actor.role <> 'company_admin' then
    raise exception 'Company administrator permission required';
  end if;
  if char_length(cleaned_name) < 2 or char_length(cleaned_name) > 120 then
    raise exception 'Driver name must contain 2 to 120 characters';
  end if;
  if cleaned_phone is not null and (char_length(cleaned_phone) > 40 or cleaned_phone !~ '^[+0-9() .-]+$') then
    raise exception 'Invalid driver phone number';
  end if;

  select p.* into previous
  from public.profiles p
  where p.id = p_driver_id
    and p.company_id = actor.company_id
    and p.role = 'driver'
  for update;
  if previous.id is null then
    raise exception 'Driver not found in company';
  end if;

  update public.profiles p
  set full_name = cleaned_name,
      phone = cleaned_phone,
      updated_at = now()
  where p.id = p_driver_id
  returning p.* into updated;

  insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    actor.company_id,
    actor.id,
    'driver.contact_updated',
    'profile',
    p_driver_id,
    jsonb_build_object('full_name', previous.full_name, 'phone', previous.phone),
    jsonb_build_object('full_name', updated.full_name, 'phone', updated.phone)
  );

  return updated;
end;
$$;

revoke all on function public.update_company_driver_contact(uuid, text, text) from public, anon;
grant execute on function public.update_company_driver_contact(uuid, text, text) to authenticated;
