-- The assigned driver may remove any BOL/POD media from the active load.
-- Dispatcher originals and all non-operational document types stay immutable.
create or replace function public.delete_operational_document(
  target_document_id uuid
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles := public.current_profile();
  target_document public.documents;
  storage_paths text[];
begin
  select d.*
  into target_document
  from public.documents d
  where d.id = target_document_id
    and d.company_id = actor.company_id
  for update;

  if target_document.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Document not found';
  end if;

  if target_document.document_type not in ('bol', 'pod') then
    raise exception using
      errcode = '55000',
      message = 'Only BOL or POD media can be deleted';
  end if;

  if actor.role = 'driver' then
    if not exists (
      select 1
      from public.loads l
      join public.assignments a on a.id = l.current_assignment_id
      where l.id = target_document.load_id
        and a.driver_id = actor.id
        and a.status = 'active'
    ) then
      raise exception using
        errcode = '42501',
        message = 'The load is not actively assigned to this driver';
    end if;
  elsif actor.role not in ('company_admin', 'dispatcher') then
    raise exception using
      errcode = '42501',
      message = 'Permission denied';
  end if;

  select coalesce(
    array_agg(v.storage_path order by v.version_number),
    array[]::text[]
  )
  into storage_paths
  from public.document_versions v
  where v.document_id = target_document.id;

  insert into public.audit_events (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    metadata
  )
  values (
    target_document.company_id,
    actor.id,
    'document.deleted',
    'document',
    target_document.id,
    to_jsonb(target_document),
    jsonb_build_object(
      'load_id', target_document.load_id,
      'document_type', target_document.document_type,
      'storage_paths', to_jsonb(storage_paths)
    )
  );

  delete from public.documents d
  where d.id = target_document.id;

  return storage_paths;
end;
$$;

revoke all on function public.delete_operational_document(uuid)
from public, anon;
grant execute on function public.delete_operational_document(uuid)
to authenticated;

-- The audit event created by the command proves that this exact user was
-- authorized to delete these exact object paths. It permits Storage cleanup
-- after the database row has already been removed.
drop policy if exists storage_load_documents_delete_operational
on storage.objects;
create policy storage_load_documents_delete_operational
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'load-documents'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.can_access_load(((storage.foldername(name))[2])::uuid)
  and (
    public.current_app_role() in ('company_admin', 'dispatcher')
    or exists (
      select 1
      from public.audit_events ae
      where ae.company_id = public.current_company_id()
        and ae.actor_id = (select auth.uid())
        and ae.action = 'document.deleted'
        and ae.entity_type = 'document'
        and ae.entity_id = ((storage.foldername(name))[3])::uuid
        and ae.metadata -> 'storage_paths' ? name
    )
  )
);

comment on function public.delete_operational_document(uuid)
is 'Deletes BOL/POD media for an assigned driver or privileged company member, records audit evidence, and returns Storage cleanup paths.';
