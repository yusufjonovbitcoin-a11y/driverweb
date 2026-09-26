alter table public.profiles
  add column if not exists avatar_path text;

alter table public.driver_profiles
  add column if not exists cdl_document_path text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-media',
  'profile-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_profile_media_read on storage.objects;
create policy storage_profile_media_read
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
);

drop policy if exists storage_profile_media_upload_own on storage.objects;
create policy storage_profile_media_upload_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists storage_profile_media_update_own on storage.objects;
create policy storage_profile_media_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists storage_profile_media_delete_own on storage.objects;
create policy storage_profile_media_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create or replace function public.set_my_profile_media(
  media_kind text,
  object_path text
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor public.profiles := public.current_profile();
  expected_prefix text;
begin
  if actor.id is null then
    raise exception 'Authenticated profile required';
  end if;
  if actor.company_id is null then
    raise exception 'Company membership required';
  end if;
  if media_kind not in ('avatar', 'driver_license') then
    raise exception 'Unsupported profile media type';
  end if;

  expected_prefix := actor.company_id::text || '/' || actor.id::text || '/';
  if object_path is null or object_path not like expected_prefix || '%' then
    raise exception 'Invalid profile media path';
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'profile-media' and name = object_path
  ) then
    raise exception 'Uploaded profile media was not found';
  end if;

  if media_kind = 'avatar' then
    update public.profiles
    set avatar_path = object_path, updated_at = now()
    where id = actor.id;
  else
    if actor.role <> 'driver' then
      raise exception 'Driver permission required';
    end if;
    update public.driver_profiles
    set cdl_document_path = object_path, updated_at = now()
    where user_id = actor.id;
  end if;
end;
$$;

revoke all on function public.set_my_profile_media(text, text) from public, anon;
grant execute on function public.set_my_profile_media(text, text) to authenticated;
