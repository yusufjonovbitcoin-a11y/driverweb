alter table public.profiles
  add column if not exists locale text not null default 'uz';

alter table public.profiles
  drop constraint if exists profiles_locale_supported;

alter table public.profiles
  add constraint profiles_locale_supported check (locale in ('uz', 'ru', 'en'));

create or replace function public.set_my_locale(requested_locale text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_locale text := lower(trim(coalesce(requested_locale, '')));
begin
  if normalized_locale not in ('uz', 'ru', 'en') then
    raise exception using errcode = '22023', message = 'unsupported_locale';
  end if;

  update public.profiles
  set locale = normalized_locale, updated_at = now()
  where id = (select auth.uid()) and status = 'active';

  if not found then
    raise exception using errcode = 'P0002', message = 'active_profile_not_found';
  end if;

  return normalized_locale;
end;
$$;

revoke all on function public.set_my_locale(text) from public;
grant execute on function public.set_my_locale(text) to authenticated;
