-- STABLE RPCs run in READ ONLY transactions in PostgREST, including POST.
-- current_profile() intentionally locks the actor for mutation commands.
-- Keep that helper unchanged; this read projection needs only a snapshot.
-- Patch the known initialization without replacing its tenant/privacy guards.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_driver_load_rows(uuid[])'::regprocedure);
  original text := 'actor public.profiles := public.current_profile();';
  replacement text := 'actor public.profiles := (select p from public.profiles p where p.id = (select auth.uid()) and p.status = ''active'');';
begin
  if strpos(definition, original) = 0 then
    raise exception 'Unexpected get_driver_load_rows actor initialization';
  end if;
  execute replace(definition, original, replacement);
end $migration$;

notify pgrst, 'reload schema';
