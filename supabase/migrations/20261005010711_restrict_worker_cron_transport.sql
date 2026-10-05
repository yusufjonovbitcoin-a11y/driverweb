-- pg_net's default PUBLIC queue permissions expose request headers. The Cron
-- transport is administrator-only, including its transient token-bearing rows.
grant usage on schema net to postgres;
grant all on all tables in schema net to postgres;
grant all on all sequences in schema net to postgres;
grant execute on all functions in schema net to postgres;
revoke all on schema net from public, anon, authenticated, service_role;
revoke all on all tables in schema net from public, anon, authenticated, service_role;
revoke all on all sequences in schema net from public, anon, authenticated, service_role;
revoke all on all functions in schema net from public, anon, authenticated, service_role;
