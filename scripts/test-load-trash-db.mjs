import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Private Unix-socket cluster only. Never reads DATABASE_URL or app credentials.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'drivex-trash-test-'));
const pgBin = process.env.PG_BIN || '';
const connection = ['-h', directory, '-p', '55441', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
function run(binary, args, input) {
  const result = spawnSync(path.join(pgBin, binary), args, { cwd: root, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(`${binary}: ${result.stderr}\n${result.stdout}`);
  if (result.stderr) process.stdout.write(result.stderr);
  return result.stdout;
}
const sql = (text) => run('psql', [...connection, '-q'], text);
async function migration(name, start, end) {
  let text = await readFile(path.join(root, 'supabase/migrations', name), 'utf8');
  if (start) {
    assert(text.includes(start), `Missing migration start: ${start}`);
    text = text.slice(text.indexOf(start));
  }
  if (end) {
    assert(text.includes(end), `Missing migration end: ${end}`);
    text = text.slice(0, text.indexOf(end));
  }
  sql(text);
}
function asyncSql(text, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(pgBin, 'psql'), [...connection, '-Atq'], { cwd: root });
    let stdout = ''; let stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Trash concurrency check timed out')); }, 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; onOutput(stdout); });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    child.stdin.end(text);
  });
}
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55441`, 'start']);
  started = true;
  sql(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  // Use real production tables, composite FKs, assignment and evidence triggers.
  // Cut before unrelated ingestion/Auth/Storage RPCs, not before any core table.
  await migration('202609240001_core_schema.sql', null, 'create or replace function public.bootstrap_company');
  await migration('202609240002_integrity_and_commands.sql', null, 'create or replace function public.set_dispatcher_driver_access');
  await migration('202609240003_security_workers_and_views.sql', null, '-- Replace broad company policies');
  await migration('202609240009_driver_load_history_access.sql');
  await migration('202609250003_manual_ai_load_imports.sql');
  sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/support.sql'), 'utf8'));
  await migration('202609280002_remove_company_member.sql', null, '-- These read RPCs');
  await migration('20261001150028_direct_driver_assignment.sql');
  await migration('20261001220059_verified_driver_brief.sql');
  await migration('202609260004_operational_integrity_and_push.sql', 'create or replace function public.required_document_type_for_stop', 'create or replace function public.begin_document_upload');
  await migration('202609260004_operational_integrity_and_push.sql', 'create or replace function public.complete_document_upload', '-- ---------------------------------------------------------------------------');
  await migration('202609260004_operational_integrity_and_push.sql', 'create or replace function public.bind_document_version_media', 'create or replace function public.complete_document_upload');
  await migration('202609260004_operational_integrity_and_push.sql', 'create table if not exists public.push_deliveries', 'create or replace function public.register_push_device');
  await migration('202609300001_driver_tracking.sql', null, 'alter table public.driver_tracking_sessions enable row level security');
  await migration('202609300002_payment_receipts.sql');
  await migration('20261002024124_company_trip_analytics.sql');
  await migration('20261003090135_trip_analytics_read_only_actor.sql');
  await migration('202609240010_driver_analytics.sql');
  sql('alter function public.get_driver_analytics(timestamptz,timestamptz) volatile;');
  await migration('20261005203020_load_trash_restore.sql');
  sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/checks.sql'), 'utf8'));

  // Same load, separate sessions: the losing stale action must fail after waiting.
  sql("select test_seed_load('00000000-0000-0000-0000-000000000090');");
  let hasLock;
  const locked = new Promise((resolve) => { hasLock = resolve; });
  const first = asyncSql(`begin; set local role authenticated;
    set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
    select (trash_load('00000000-0000-0000-0000-000000000090',1)).version;
    select 'TRASH_LOCKED'; select pg_sleep(0.4); commit;`, (output) => { if (output.includes('TRASH_LOCKED')) hasLock(); });
  await Promise.race([locked, first.then((result) => { if (!result.stdout.includes('TRASH_LOCKED')) throw new Error(result.stderr); })]);
  const second = asyncSql(`set role authenticated;
    set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
    select (trash_load('00000000-0000-0000-0000-000000000090',1)).version;`);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.code, 0, a.stderr);
  assert.notEqual(b.code, 0);
  assert.match(b.stderr, /LOAD_TRASH_CONFLICT/);
  sql("select test_assert((select count(*) from audit_events where entity_id='00000000-0000-0000-0000-000000000090' and action='load.trashed')=1,'concurrent trash commits exactly once');");
  console.log('PASS: concurrent trash actions serialize and reject stale versions');

  let restoreHasLock;
  const restoreLocked = new Promise((resolve) => { restoreHasLock = resolve; });
  const restore = asyncSql(`begin; set local role authenticated;
    set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
    select (restore_trashed_load('00000000-0000-0000-0000-000000000090',2)).version;
    select 'RESTORE_LOCKED'; select pg_sleep(0.4); commit;`, (output) => { if (output.includes('RESTORE_LOCKED')) restoreHasLock(); });
  await Promise.race([restoreLocked, restore.then((result) => { if (!result.stdout.includes('RESTORE_LOCKED')) throw new Error(result.stderr); })]);
  const deletion = asyncSql(`set role authenticated;
    set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
    select permanently_delete_trashed_load('00000000-0000-0000-0000-000000000090',2);`);
  const [restored, deleted] = await Promise.all([restore, deletion]);
  assert.equal(restored.code, 0, restored.stderr);
  assert.notEqual(deleted.code, 0);
  assert.match(deleted.stderr, /LOAD_TRASH_CONFLICT/);
  sql("select test_assert((select trashed_at is null and version=3 from loads where id='00000000-0000-0000-0000-000000000090'),'stale permanent deletion cannot delete concurrently restored load');");
  console.log('PASS: concurrent restore protects load from stale permanent deletion');
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
