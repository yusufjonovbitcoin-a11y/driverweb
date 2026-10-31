-- Opt-in MFA: unenrolled accounts continue working; enrolled users must complete AAL2.
grant usage on schema private to authenticated,anon;
create or replace function private.mfa_session_satisfied() returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is null or coalesce((select auth.jwt())->>'aal','aal1')='aal2'
 or not exists(select 1 from auth.mfa_factors f where f.user_id=(select auth.uid()) and f.status='verified');
$$;
revoke all on function private.mfa_session_satisfied() from public;
grant execute on function private.mfa_session_satisfied() to authenticated,anon;
create or replace function public.require_mfa_session() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.mfa_session_satisfied() then raise exception 'MFA_REQUIRED' using errcode='42501';end if;
end;$$;
revoke all on function public.require_mfa_session() from public;
grant execute on function public.require_mfa_session() to anon,authenticated;
-- Include security-definer RPCs; restrictive RLS also covers Storage and Realtime.
do $$declare item record; existing text;begin
 select unnest(setconfig) into existing from pg_db_role_setting where setrole=(select oid from pg_roles where rolname='authenticator') and setconfig::text ilike '%pgrst.db_pre_request%';
 if existing is not null and existing<>'pgrst.db_pre_request=public.require_mfa_session' then raise exception 'Review existing pre-request hook before replacing';end if;
 for item in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) loop
  execute format('create policy enrolled_mfa_required on %I.%I as restrictive to authenticated using ((select private.mfa_session_satisfied())) with check ((select private.mfa_session_satisfied()))',item.nspname,item.relname);
 end loop;
end;$$;
alter role authenticator set pgrst.db_pre_request='public.require_mfa_session';
revoke execute on function public.ensure_vehicle_assignment_tenant() from public,anon,authenticated;
notify pgrst,'reload config';
notify pgrst,'reload schema';
