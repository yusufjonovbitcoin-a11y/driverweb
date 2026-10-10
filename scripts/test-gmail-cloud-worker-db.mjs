import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Creates its own socket-only PostgreSQL cluster. Never reads app env files,
// DATABASE_URL, credentials, or a production connection string.
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), 'tfleets-gmail-cloud-'));
const bin = process.env.PG_BIN || '';
const connection = ['-h', dir, '-p', '55449', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
function run(exe, args, input) {
  const result = spawnSync(path.join(bin, exe), args, { cwd: root, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr + result.stdout);
  return result.stdout;
}
const sql = text => run('psql', connection, text);
const source = file => readFile(path.join(root, file), 'utf8');
function session(text, marker) {
  const child = spawn(path.join(bin, 'psql'), connection, { cwd: root });
  let out = '', err = '', signal;
  const ready = new Promise(resolve => { signal = resolve; });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Local concurrency test timed out')); }, 10_000);
    child.stdout.on('data', chunk => { out += chunk; if (marker && out.includes(marker)) signal(); });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
  child.stdin.write(text + '\n');
  if (!marker) child.stdin.end();
  return { done, ready: marker ? Promise.race([ready, done.then(r => { throw new Error(r.err || 'Transaction ended before marker'); })]) : done,
    commit: () => child.stdin.end('commit;\n') };
}
async function waitForLock(name) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`).trim() === 't') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Expected second local session to wait for the row lock');
}
let started = false;
try {
  run('initdb', ['-D', dir + '/data', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', dir + '/data', '-l', dir + '/server.log', '-o', `-k ${dir} -h '' -p 55449`, 'start']);
  started = true;
  sql(await source('scripts/gmail-cloud-test-fixtures/bootstrap.sql'));
  sql(await source('supabase/migrations/20261007214350_gmail_cloud_worker_paused.sql'));
  sql(await source('scripts/gmail-cloud-test-fixtures/checks.sql'));
  sql(await source('scripts/gmail-cloud-test-fixtures/maintenance.sql'));
  assert.equal(sql('select count(*) from public.gmail_connections;').trim(), '0', 'fixture transaction must roll back');
  const company = '10000000-0000-0000-0000-000000000001';
  const connectionId = '20000000-0000-0000-0000-000000000001';
  const ownerA = '30000000-0000-0000-0000-000000000001';
  const ownerB = '30000000-0000-0000-0000-000000000002';
  sql(`insert into companies values ('${company}'); insert into gmail_connections(id,company_id) values ('${connectionId}','${company}');
    insert into gmail_cloud_worker_controls(company_id,enabled) values ('${company}',true);`);
  const first = session(`begin; set local role service_role;
    select claim_gmail_cloud_worker('${company}','${ownerA}')->>'status'; select 'FIRST_CLAIM_HELD';`, 'FIRST_CLAIM_HELD');
  await first.ready;
  const second = session(`set application_name='gmail-claim-race'; set role service_role;
    select claim_gmail_cloud_worker('${company}','${ownerB}')->>'status';`);
  try { await waitForLock('gmail-claim-race'); } finally { first.commit(); }
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.err); assert.match(a.out, /claimed/);
  assert.equal(b.code, 0, b.err); assert.equal(b.out.trim(), 'busy');
  // A waiting checkpoint must re-read the committed disable, not its old view.
  const disabled = session(`begin; update gmail_cloud_worker_controls set enabled=false where company_id='${company}'; select 'DISABLE_HELD';`, 'DISABLE_HELD');
  await disabled.ready;
  const checkpoint = session(`set application_name='gmail-disable-race'; set role service_role;
    select checkpoint_gmail_cloud_worker('${company}','${ownerA}','${connectionId}',1,'123',99)->>'status';`);
  try { await waitForLock('gmail-disable-race'); } finally { disabled.commit(); }
  const [d, c] = await Promise.all([disabled.done, checkpoint.done]);
  assert.equal(d.code, 0, d.err); assert.equal(c.code, 0, c.err); assert.equal(c.out.trim(), 'lost');
  assert.equal(sql(`select provider_history_id is null from gmail_connections where id='${connectionId}';`).trim(), 't');
  sql(`update gmail_cloud_worker_controls set enabled=true,uid_validity='123' where company_id='${company}';
    select claim_gmail_cloud_worker('${company}','${ownerB}');
    insert into jobs(id,company_id,type,status,locked_at,locked_by) values
    ('50000000-0000-0000-0000-000000000001','${company}','gmail_label_assignment','processing',now()-interval '5 minutes','gmail-cloud:old');`);
  const maintenanceDisable = session(`begin; update gmail_cloud_worker_controls set enabled=false where company_id='${company}'; select 'MAINTENANCE_DISABLE_HELD';`, 'MAINTENANCE_DISABLE_HELD');
  await maintenanceDisable.ready;
  const maintenance = session(`set application_name='gmail-maintenance-disable-race'; set role service_role;
    select recover_gmail_cloud_label_jobs('${company}','${ownerB}','${connectionId}',1)->>'status';
    select select_gmail_cloud_pending_attachments('${company}','${ownerB}','${connectionId}',1)->>'status';`);
  try { await waitForLock('gmail-maintenance-disable-race'); } finally { maintenanceDisable.commit(); }
  const [md, m] = await Promise.all([maintenanceDisable.done, maintenance.done]);
  assert.equal(md.code, 0, md.err); assert.equal(m.code, 0, m.err); assert.equal(m.out.trim(), 'lost\nlost');
  assert.equal(sql("select status from jobs where id='50000000-0000-0000-0000-000000000001';").trim(), 'processing');
  console.log('PASS: paused defaults, service-only invoker/RLS, tenant/version/explicit UID fences, monotonic checkpoints, stale owners, bounded recovery/backlog selection, rollback, concurrent claim/checkpoint/maintenance disable races');
} finally {
  if (started) run('pg_ctl', ['-D', dir + '/data', '-m', 'fast', 'stop']);
  await rm(dir, { recursive: true, force: true });
}
