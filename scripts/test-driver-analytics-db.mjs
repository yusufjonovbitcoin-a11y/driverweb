import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated Unix-socket PostgreSQL only; never reads application credentials or
// DATABASE_URL. Load actual table/function migration slices, not SQL mocks.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'driver-analytics-test-'));
const pgBin = process.env.PG_BIN || '';
function run(binary, args, input) {
  const result = spawnSync(path.join(pgBin, binary), args, {
    cwd: root, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  if (result.stderr) process.stdout.write(result.stderr);
  return result.stdout;
}
const sql = text => run('psql', ['-h', directory, '-p', '55442', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], text);
async function migration(name, start, end) {
  let body = await readFile(path.join(root, 'supabase/migrations', name), 'utf8');
  if (start) { assert(body.includes(start)); body = body.slice(body.indexOf(start)); }
  if (end) { assert(body.includes(end)); body = body.slice(0, body.indexOf(end)); }
  sql(body);
}
const actor = `set role authenticated; set "request.jwt.claim.sub"='90000000-0000-0000-0000-000000000012';`;
const summary = () => JSON.parse(sql(`${actor} select get_driver_analytics_in_zone('2026-10-07T00:00:00Z','2026-10-08T00:00:00Z','America/New_York');`));
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55442`, 'start']);
  started = true;
  sql(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await migration('202609240001_core_schema.sql', null, 'create or replace function public.bootstrap_company');
  await migration('202609240002_integrity_and_commands.sql', null, 'create or replace function public.set_dispatcher_driver_access');
  await migration('202609240003_security_workers_and_views.sql', null, 'create or replace function public.can_access_load');
  await migration('202609280002_remove_company_member.sql', null, '-- These read RPCs');
  await migration('20261005205741_load_trash_restore.sql', null, '-- Keep existing column positions');
  await migration('20261006110319_driver_mileage_pay.sql', null, 'create function public.update_driver_contact_and_pay');
  await migration('20261006110319_driver_mileage_pay.sql', '-- Driver analytics are calculated');
  sql('alter table public.driver_pay_settings add column hide_rate_con boolean not null default false;');
  await migration('20261006180006_driver_rate_con_privacy.sql', 'create or replace function private.hide_broker_terms', 'create or replace function public.get_driver_load_rows');
  await migration('20261006180006_driver_rate_con_privacy.sql', '-- Analytics is SECURITY DEFINER');
  await migration('20261006131928_mobile_reliability_hardening.sql', 'create function public.get_driver_analytics_in_zone', 'create function public.advance_driver_route');
  const fixture = await readFile(path.join(root, 'scripts/load-trash-test-fixtures/driver-analytics-checks.sql'), 'utf8');
  const [seed, checks] = fixture.split('-- ASSERTIONS AFTER MIGRATION');
  assert(seed && checks);
  sql(seed);
  const before = summary();
  assert.equal(before.onTimeCount, 0, 'old query mislabels late administrative completion');
  await migration('20261006204927_driver_analytics_delivery_arrival.sql');
  const after = summary();
  for (const field of ['grossRevenue', 'loadedMiles', 'deadheadMiles', 'effectiveRpm', 'completedCount', 'activeCount', 'grossChangePercent', 'daily', 'recentLoads']) {
    assert.deepEqual(after[field], before[field], `${field} must not change`);
  }
  sql(checks);
  console.log('PASS: delivery arrival analytics, unknown evidence, legacy/multi-stop, privacy, roles, timezone and unchanged financial totals');
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
