import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readMigration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const previous = readMigration('20261002033901_analytics_dashboard_charts.sql');
const migration = readMigration('20261003090135_trip_analytics_read_only_actor.sql');
const withoutComments = (sql) => sql.replace(/^--.*\n/gm, '').trim();

test('analytics actor lookup does not lock rows in the read-only PostgREST RPC', () => {
  assert.match(migration, /language plpgsql stable security invoker set search_path = public/);
  assert.doesNotMatch(withoutComments(migration), /current_profile\s*\(|for\s+(?:key\s+share|update|share|no\s+key\s+update)/i);
  assert.match(migration, /select \* into actor\s+from public\.profiles p\s+where p\.id = \(select auth\.uid\(\)\);/);
  assert.match(migration, /actor\.status <> 'active' or actor\.role not in \('company_admin','dispatcher'\)/);
  assert.match(migration, /where l\.company_id=actor\.company_id/);
});

test('read-only fix preserves calculations, filters, paging, permissions, and return shape', () => {
  const expected = previous
    .replace('  actor public.profiles := public.current_profile();', '  actor public.profiles;')
    .replace('begin\n  if actor.id', 'begin\n  select * into actor\n  from public.profiles p\n  where p.id = (select auth.uid());\n\n  if actor.id');
  assert.equal(withoutComments(migration), withoutComments(expected));
});
