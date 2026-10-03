-- Only authenticated company admins and dispatchers can SELECT these rows
-- through their existing RLS policies. Realtime changes are re-fetched by the
-- client, not used as the source of truth. Do not subscribe to DELETE events:
-- Postgres Changes cannot apply row-level SELECT policies to deleted rows.
do $$
declare
  inbox_table text;
begin
  foreach inbox_table in array array[
    'broker_messages',
    'broker_attachments',
    'ai_extractions',
    'broker_message_reads'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = inbox_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', inbox_table);
    end if;
  end loop;
end $$;
