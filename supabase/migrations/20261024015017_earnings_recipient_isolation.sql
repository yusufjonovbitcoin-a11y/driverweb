-- Earnings are visible only to company administrators and the addressed driver.
alter policy earnings_recipient_read on public.driver_earnings using (
 company_id=(select public.current_company_id()) and (
  (select public.current_app_role())::text='company_admin' or driver_id=(select auth.uid())
 )
);
create or replace function private.can_read_driver_earnings(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.can_upload_driver_earnings(path) or exists (
 select 1 from public.driver_earnings e join public.profiles a on a.company_id=e.company_id
 where e.storage_path=path and a.id=(select auth.uid()) and a.status::text='active'
 and (a.role::text='company_admin' or (a.role::text='driver' and e.driver_id=a.id)));
$$;
revoke all on function private.can_read_driver_earnings(text) from public,anon;
grant execute on function private.can_read_driver_earnings(text) to authenticated;
notify pgrst,'reload schema';
