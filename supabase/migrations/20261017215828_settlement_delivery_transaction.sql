-- current_profile() acquires a key-share lock. PostgREST executes STABLE RPCs
-- in read-only transactions, which rejects that lock even though this endpoint
-- does not write settings, loads or financial records.
alter function public.driver_settlement_delivery_dates() volatile;
notify pgrst, 'reload schema';
