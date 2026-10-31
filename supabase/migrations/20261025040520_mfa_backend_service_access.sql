-- The API pre-request hook runs for backend service_role requests too.
-- Keep the existing user AAL checks; restore only the trusted backend's ability
-- to evaluate the same private guard before document delivery/rate-limit RPCs.
grant usage on schema private to service_role;
grant execute on function private.mfa_session_satisfied() to service_role;
grant execute on function public.require_mfa_session() to service_role;
notify pgrst,'reload schema';
