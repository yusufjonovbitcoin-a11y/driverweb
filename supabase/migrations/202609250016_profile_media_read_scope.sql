drop policy if exists storage_profile_media_read on storage.objects;
create policy storage_profile_media_read
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.can_access_driver(((storage.foldername(name))[2])::uuid)
);
