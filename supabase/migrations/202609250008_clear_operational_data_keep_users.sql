-- One-time production reset requested by the operator. Preserve identities,
-- tenant membership and company configuration while removing app activity.

do $$
declare
  auth_user_count_before bigint;
  profile_count_before bigint;
  company_count_before bigint;
begin
  select count(*) into auth_user_count_before from auth.users;
  select count(*) into profile_count_before from public.profiles;
  select count(*) into company_count_before from public.companies;

  truncate table
    public.chat_call_signals,
    public.chat_calls,
    public.chat_messages,
    public.chat_conversations,
    public.warnings,
    public.document_checks,
    public.document_versions,
    public.documents,
    public.assignments,
    public.offers,
    public.load_price_snapshots,
    public.load_stops,
    public.location_snapshots,
    public.client_operations,
    public.notifications,
    public.jobs,
    public.audit_events,
    public.manual_load_imports,
    public.ai_extraction_fields,
    public.ai_extractions,
    public.broker_attachments,
    public.loads,
    public.broker_messages,
    public.driver_presence;

  if (select count(*) from auth.users) <> auth_user_count_before then
    raise exception 'Safety check failed: auth user count changed';
  end if;
  if (select count(*) from public.profiles) <> profile_count_before then
    raise exception 'Safety check failed: profile count changed';
  end if;
  if (select count(*) from public.companies) <> company_count_before then
    raise exception 'Safety check failed: company count changed';
  end if;

  raise notice 'Operational data cleared. Preserved % auth users, % profiles and % companies.',
    auth_user_count_before, profile_count_before, company_count_before;
end;
$$;
