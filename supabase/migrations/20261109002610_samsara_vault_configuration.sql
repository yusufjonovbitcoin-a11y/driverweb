-- Vault decrypts only these four integration settings. No generic secret lookup
-- is exposed. Service-only EXECUTE is required because Edge handlers authenticate
-- users separately, and callback/Cron have no user JWT.
create function public.get_samsara_server_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(upper(name),decrypted_secret),'{}'::jsonb)
  from vault.decrypted_secrets where name in (
    'samsara_client_id','samsara_client_secret','samsara_encryption_key','samsara_worker_token'
  );
$$;
revoke all on function public.get_samsara_server_config() from public,anon,authenticated;
grant execute on function public.get_samsara_server_config() to service_role;
