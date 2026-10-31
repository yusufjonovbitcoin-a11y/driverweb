-- The public pre-request hook only delegates to a narrowly scoped private check.
-- It needs no definer privileges of its own.
alter function public.require_mfa_session() security invoker;
notify pgrst,'reload schema';
