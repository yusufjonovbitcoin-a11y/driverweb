-- Cloudinary load-document uploads use a short-lived document-version ID as
-- their context while legacy records use the load ID. Resolve both forms when
-- authorizing reads so a valid current document cannot make the workspace fail.

create or replace function public.can_read_load_media_context(
  target_context_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_load(target_context_id)
    or exists (
      select 1
      from public.document_versions v
      join public.documents d on d.id = v.document_id
      where v.id = target_context_id
        and public.can_access_load(d.load_id)
    );
$$;

revoke all on function public.can_read_load_media_context(uuid)
from public, anon;
grant execute on function public.can_read_load_media_context(uuid)
to authenticated;

drop policy if exists media_assets_select_company on public.media_assets;
create policy media_assets_select_company
on public.media_assets for select to authenticated
using (
  company_id = public.current_company_id()
  and deleted_at is null
  and case
    when scope = 'chat' then public.can_access_chat_conversation(context_id)
    when scope = 'load_document' then public.can_read_load_media_context(context_id)
    when scope in ('profile_avatar', 'driver_document') then
      context_id = (select auth.uid())
      or public.current_app_role() in ('company_admin', 'dispatcher', 'super_admin')
    when scope in ('broker_original', 'gmail_raw') then
      public.current_app_role() in ('company_admin', 'dispatcher')
    else public.current_app_role() in ('company_admin', 'dispatcher', 'super_admin')
  end
);
