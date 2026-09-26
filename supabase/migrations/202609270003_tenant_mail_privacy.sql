-- Platform administrators manage companies, but they must not read tenant
-- mailbox contents. Broker mail and its derived AI data remain visible only
-- to operational staff inside the owning company.

drop policy if exists gmail_connections_privileged_read on public.gmail_connections;
create policy gmail_connections_privileged_read
on public.gmail_connections for select to authenticated
using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

drop policy if exists broker_messages_privileged_read on public.broker_messages;
create policy broker_messages_privileged_read
on public.broker_messages for select to authenticated
using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

drop policy if exists broker_attachments_privileged_read on public.broker_attachments;
create policy broker_attachments_privileged_read
on public.broker_attachments for select to authenticated
using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

drop policy if exists ai_extractions_privileged_read on public.ai_extractions;
create policy ai_extractions_privileged_read
on public.ai_extractions for select to authenticated
using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

drop policy if exists ai_fields_privileged_read on public.ai_extraction_fields;
create policy ai_fields_privileged_read
on public.ai_extraction_fields for select to authenticated
using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

-- Raw broker messages may live in either Supabase Storage or the Cloudinary
-- registry. These policies must match the relational inbox boundary.
drop policy if exists storage_broker_originals_read on storage.objects;
create policy storage_broker_originals_read
on storage.objects for select to authenticated
using (
  bucket_id = 'broker-originals'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

drop policy if exists media_assets_select_company on public.media_assets;
create policy media_assets_select_company
on public.media_assets for select to authenticated
using (
  company_id = public.current_company_id()
  and deleted_at is null
  and case
    when scope = 'chat' then public.can_access_chat_conversation(context_id)
    when scope = 'load_document' then public.can_access_load(context_id)
    when scope in ('profile_avatar', 'driver_document') then
      context_id = (select auth.uid())
      or public.current_app_role() in ('company_admin', 'dispatcher', 'super_admin')
    when scope in ('broker_original', 'gmail_raw') then
      public.current_app_role() in ('company_admin', 'dispatcher')
    else public.current_app_role() in ('company_admin', 'dispatcher', 'super_admin')
  end
);
