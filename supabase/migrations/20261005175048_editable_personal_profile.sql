-- Version matches the applied remote migration. Profiles/companies have SELECT-only grants. Keep writes
-- behind a narrow authenticated API, without granting arbitrary row updates.
create schema if not exists profile_settings_private;
revoke all on schema profile_settings_private from public, anon;
grant usage on schema profile_settings_private to authenticated;

create or replace function profile_settings_private.update_my_profile(
  p_full_name text, p_phone text, p_company_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  updated public.profiles;
  company_name text;
  old_company_name text;
  clean_name text := btrim(coalesce(p_full_name, ''));
  clean_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  clean_company text := btrim(p_company_name);
begin
  if auth.uid() is null then raise exception 'PROFILE_UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into actor from public.profiles where id = auth.uid() for update;
  if actor.id is null or actor.status <> 'active' then
    raise exception 'PROFILE_UNAUTHENTICATED' using errcode = '42501';
  end if;
  if char_length(clean_name) not between 2 and 120 then raise exception 'PROFILE_NAME_INVALID' using errcode = '22023'; end if;
  if clean_phone is not null and (char_length(clean_phone) > 40 or clean_phone !~ '^[+0-9() .-]+$' or clean_phone !~ '[0-9]') then
    raise exception 'PROFILE_PHONE_INVALID' using errcode = '22023';
  end if;
  if p_company_name is not null then
    if actor.role <> 'company_admin' or actor.company_id is null then
      raise exception 'PROFILE_COMPANY_FORBIDDEN' using errcode = '42501';
    end if;
    if char_length(clean_company) not between 2 and 160 then raise exception 'PROFILE_COMPANY_INVALID' using errcode = '22023'; end if;
    select name into old_company_name from public.companies where id = actor.company_id and status = 'active' for update;
    if not found then raise exception 'PROFILE_COMPANY_FORBIDDEN' using errcode = '42501'; end if;
    update public.companies set name = clean_company where id = actor.company_id;
    if old_company_name is distinct from clean_company then
      insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values(actor.company_id, actor.id, 'company.name_updated', 'company', actor.company_id,
        jsonb_build_object('name', old_company_name), jsonb_build_object('name', clean_company));
    end if;
  end if;
  update public.profiles set full_name = clean_name, phone = clean_phone where id = actor.id returning * into updated;
  select name into company_name from public.companies where id = actor.company_id;
  if actor.full_name is distinct from updated.full_name or actor.phone is distinct from updated.phone then
    insert into public.audit_events(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values(actor.company_id, actor.id, 'profile.personal_updated', 'profile', actor.id,
      jsonb_build_object('full_name', actor.full_name, 'phone', actor.phone),
      jsonb_build_object('full_name', updated.full_name, 'phone', updated.phone));
  end if;
  return jsonb_build_object('id', updated.id, 'full_name', updated.full_name, 'phone', updated.phone, 'company_name', company_name);
end;
$$;
revoke all on function profile_settings_private.update_my_profile(text,text,text) from public, anon;
grant execute on function profile_settings_private.update_my_profile(text,text,text) to authenticated;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_company_name text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select profile_settings_private.update_my_profile(p_full_name, p_phone, p_company_name);
$$;
revoke all on function public.update_my_profile(text,text,text) from public, anon;
grant execute on function public.update_my_profile(text,text,text) to authenticated;
