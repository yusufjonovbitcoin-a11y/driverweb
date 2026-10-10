import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuditBackendChecks } from './run-audit-backend-checks.mjs';

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
  await migration('20261001151138_direct_driver_assignment.sql');
  await migration('20261001222100_verified_driver_brief.sql');
  await migration('202609260004_operational_integrity_and_push.sql', 'create or replace function public.required_document_type_for_stop', 'create or replace function public.begin_document_upload');
  await migration('202609260004_operational_integrity_and_push.sql', 'create or replace function public.complete_document_upload', '-- ---------------------------------------------------------------------------');
  await migration('202609260004_operational_integrity_and_push.sql', 'create or replace function public.bind_document_version_media', 'create or replace function public.complete_document_upload');
  await migration('202609260004_operational_integrity_and_push.sql', 'create table if not exists public.push_deliveries', 'create or replace function public.register_push_device');
  await migration('202609300001_driver_tracking.sql', null, 'alter table public.driver_tracking_sessions enable row level security');
  await migration('202609300002_payment_receipts.sql');
  await migration('20261002025707_company_trip_analytics.sql');
  await migration('20261003090404_trip_analytics_read_only_actor.sql');
  await migration('202609240010_driver_analytics.sql');
  sql('alter function public.get_driver_analytics(timestamptz,timestamptz) volatile;');
  await migration('20261005205741_load_trash_restore.sql');
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
  if (process.env.BACKEND_AUDIT_TEST === '1') {
    await migration('202609240001_core_schema.sql', 'create or replace function public.create_load_draft(', 'create or replace function public.approve_load_draft(');
    await migration('202609250004_ai_document_intelligence.sql', null, 'create or replace function public.apply_ai_import_metadata');
    await migration('202609270002_semantic_warning_payloads.sql');
    await migration('20261007003559_atomic_document_import_draft.sql');
    await migration('20261007003612_durable_document_check_worker.sql', null, '-- Preserve the existing credential-safe synchronous transport.');
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/backend-audit-checks.sql'), 'utf8'));
    console.log('PASS: atomic import rollback/retry, authorization and durable document check recovery');
  }
  if (process.env.DRIVER_PAY_TEST === '1') {
    await migration('202610010004_update_company_driver_contact.sql');
    await migration('20261006110319_driver_mileage_pay.sql');
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/driver-pay-checks.sql'), 'utf8'));
    await migration('202609240004_operational_hardening.sql', 'create or replace function public.assert_assignment_confirmed', 'create or replace function public.transition_stop');
    await migration('202609280004_idempotent_driver_arrival.sql');
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/mobile-reliability-upgrade-seed.sql'), 'utf8'));
    await migration('20261006131928_mobile_reliability_hardening.sql');
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/mobile-reliability-checks.sql'), 'utf8'));
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/mobile-reliability-upgrade-checks.sql'), 'utf8'));

    // Route mutations use the parent-load lock. A simultaneous stale action
    // fails, while the exact same operation safely replays after that lock.
    let routeHasLock;
    const routeLocked = new Promise((resolve) => { routeHasLock = resolve; });
    const routeVersion = sql("select version from loads where id='00000000-0000-0000-0000-000000000415';").match(/\n\s*(\d+)\s*\n/)[1];
    const routeCommand = `select advance_driver_route('00000000-0000-0000-0000-000000000415','en_route_to_pickup',
      '00000000-0000-0000-0000-000000000451',${routeVersion});`;
    const routeActor = `set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';`;
    const routeFirst = asyncSql(`begin; ${routeActor} ${routeCommand}
      select 'ROUTE_LOCKED'; select pg_sleep(0.4); commit;`, (output) => { if (output.includes('ROUTE_LOCKED')) routeHasLock(); });
    await Promise.race([routeLocked, routeFirst.then((result) => { if (!result.stdout.includes('ROUTE_LOCKED')) throw new Error(result.stderr); })]);
    const routeRetry = asyncSql(`${routeActor} ${routeCommand}`);
    const routeStale = asyncSql(`${routeActor} select advance_driver_route('00000000-0000-0000-0000-000000000415',
      'arrived_at_pickup','00000000-0000-0000-0000-000000000452',${routeVersion});`);
    const [routeCommitted, routeReplayed, routeRejected] = await Promise.all([routeFirst, routeRetry, routeStale]);
    assert.equal(routeCommitted.code, 0, routeCommitted.stderr);
    assert.equal(routeReplayed.code, 0, routeReplayed.stderr);
    assert.notEqual(routeRejected.code, 0);
    assert.match(routeRejected.stderr, /Load changed/);
    sql("select test_assert((select count(*)=1 from client_operations where operation_id='00000000-0000-0000-0000-000000000451'),'concurrent route retry commits exactly once');");
    console.log('PASS: concurrent route retry replays and stale mutation is rejected');
    await migration('20261006180006_driver_rate_con_privacy.sql');
    // Match PostgREST's STABLE RPC transaction mode, not psql's default write mode.
    const driverRead = `begin read only; set local role authenticated;
      set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';`;
    sql(`${driverRead} select test_error($$select * from get_driver_load_rows(
      array['00000000-0000-0000-0000-000000000201'::uuid])$$,'read-only transaction'); rollback;`);
    await migration('20261006184102_driver_load_rows_read_only_actor.sql');
    sql(`${driverRead}
      select test_assert((select count(*)=1 from get_driver_load_rows(
        array['00000000-0000-0000-0000-000000000201'::uuid])), 'driver load RPC works in READ ONLY');
      select test_assert(not exists(select 1 from get_driver_load_rows(
        array['00000000-0000-0000-0000-000000000090'::uuid])), 'unassigned load remains inaccessible');
      set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
      select test_error($$select * from get_driver_load_rows('{}'::uuid[])$$,'Active driver required');
      set local "request.jwt.claim.sub"='';
      select test_error($$select * from get_driver_load_rows('{}'::uuid[])$$,'Active driver required');
      rollback;`);
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/rate-con-privacy-checks.sql'), 'utf8'));
    console.log('PASS: Rate Con privacy, staff/tenant guards, document access, analytics and reversible settings');
    await migration('20261006193423_driver_document_stop_projection.sql');
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/document-stop-projection-checks.sql'), 'utf8'));
    console.log('PASS: reviewed PDF stop projection, hidden prices, exact schedules and read-only RPC');
    if (process.env.SECURITY_AUDIT_TEST === '1') {
      // Restore real scoped policies omitted by the minimal operational harness.
      await migration('202609240003_security_workers_and_views.sql',
        'drop policy if exists assignments_company_read', 'drop policy if exists storage_company_read');
      await migration('202609300001_driver_tracking.sql',
        'alter table public.driver_tracking_sessions enable row level security', 'create function public.current_driver_tracking_assignment');
      sql(`create function storage.foldername(text) returns text[] language sql immutable as $$
        select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
        grant delete on storage.objects to authenticated;`);
      await migration('202609250014_assigned_driver_document_delete.sql');
      await migration('20261007003549_audit_auth_storage_privacy_hardening.sql');
      sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/security-audit-checks.sql'), 'utf8'));
      console.log('PASS: security audit active-tenant reads, legacy completion denial, Storage retention and trash/privacy');
      if (process.env.DOCUMENT_PRIVACY_TEST === '1') {
        await migration('202609270002_semantic_warning_payloads.sql');
        // Match production RLS and publication omitted by this focused harness.
        sql('alter table document_checks enable row level security; create publication supabase_realtime;');
        await migration('20261007003622_private_document_check_projection.sql');
        sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/document-check-privacy.sql'), 'utf8'));
        console.log('PASS: historic check JSON protected in raw REST/view, safe status and realtime signal retained');
      }
    }
  }
  if (process.env.AUDIT_FIX_TEST === '1') {
    assert(['BACKEND_AUDIT_TEST','DRIVER_PAY_TEST','SECURITY_AUDIT_TEST','DOCUMENT_PRIVACY_TEST'].every(key => process.env[key] === '1'), 'AUDIT_FIX_TEST requires the complete fixture');
    await runAuditBackendChecks({sql,migration,root});
  }
  if (process.env.PENDING_DRIVER_PAY_TEST === '1') {
    assert.equal(process.env.AUDIT_FIX_TEST, '1', 'Pending pay requires the current hardened schema fixture');
    // Production includes legacy review_fixture snapshots. Their recorded
    // non-null origin remains valid; this additive migration must not backfill
    // or reject them merely because the original provider has another name.
    sql(`insert into assignment_driver_pay(assignment_id,load_id,driver_id,company_id,rate_per_mile,
      loaded_miles,deadhead_miles,route_fingerprint,origin_latitude,origin_longitude,location_at,provider)
      select id,load_id,driver_id,company_id,0.25,1,0,'legacy-review',40,-74,now(),'review_fixture'
      from assignments where load_id='00000000-0000-0000-0000-000000000200' order by assigned_at limit 1;`);
    // Transport is tested separately with a mocked http extension. This fixture
    // exercises additive allowlist/idle guard, never an external HTTP request.
    sql(`create schema worker_cron;
      create table worker_cron.last_invocations(worker text primary key constraint last_invocations_worker_check check(worker in ('push','media','document','native_calls')));
      create function worker_cron.invoke(worker_name text) returns bigint language plpgsql as $$
declare secret_name text; endpoint text;
begin
  case worker_name
    when 'push' then secret_name:='chat_push_cron_token'; endpoint:='process-push-notifications';
    when 'document' then secret_name:='document_check_cron_token'; endpoint:='check-load-document';
    when 'native_calls' then secret_name:='chat_push_cron_token'; endpoint:='process-native-call-push';
    when 'media' then secret_name:='chat_media_cron_token'; endpoint:='process-media-deletions';
    else raise exception 'Unknown scheduled worker';
  end case;
  return 1;
end $$; revoke all on schema worker_cron from public,anon,authenticated,service_role;`);
    await migration('20261008092404_assignment_driver_pay_pending.sql');
    sql(`select test_assert(worker_cron.invoke('driver_pay')=0,'empty payment queue does not send idle HTTP');
      insert into worker_cron.last_invocations values('push'),('media'),('document'),('native_calls'),('driver_pay');
      select test_assert((select count(*)=5 from worker_cron.last_invocations),'Cron worker allowlist preserves every existing worker');`);
    sql("select test_assert((select provider='review_fixture' and amount=0.25 and origin_latitude=40 from assignment_driver_pay where load_id='00000000-0000-0000-0000-000000000200'),'legacy review_fixture snapshot survives unchanged');");
    sql(await readFile(path.join(root, 'scripts/load-trash-test-fixtures/pending-driver-pay-checks.sql'), 'utf8'));
    const actor = `set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';`;
    const pendingId = sql("select current_assignment_id from loads where id='00000000-0000-0000-0000-000000000809';").match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)[0];
    const version = sql("select version from loads where id='00000000-0000-0000-0000-000000000809';").match(/\n\s*(\d+)\s*\n/)[1];
    const captured = new Date().toISOString();
    const command = `select start_driver_load_with_pay('00000000-0000-0000-0000-000000000809','00000000-0000-0000-0000-000000000889',${version},'${captured}',41,-75,8);`;
    let locked;
    const lock = new Promise(resolve => { locked = resolve; });
    const one = asyncSql(`begin; ${actor} ${command} select 'PAY_LOCKED'; select pg_sleep(0.4); commit;`, output => { if (output.includes('PAY_LOCKED')) locked(); });
    await Promise.race([lock, one.then(result => { if (!result.stdout.includes('PAY_LOCKED')) throw new Error(result.stderr); })]);
    const two = asyncSql(`${actor} ${command}`);
    const other = asyncSql(`${actor} ${command.replace('41,-75,8','42,-75,8')}`);
    const [firstPay, samePay, changedPay] = await Promise.all([one,two,other]);
    assert.equal(firstPay.code,0,firstPay.stderr);
    assert.equal(samePay.code,0,samePay.stderr);
    assert.notEqual(changedPay.code,0);
    assert.match(changedPay.stderr,/DRIVER_PAY_START_OPERATION_CONFLICT/);
    sql(`select test_assert((select count(*)=1 from audit_events where entity_id='${pendingId}' and action='driver.pay_start_captured'),'concurrent START creates one origin/job and one audit event');`);
    let claimLocked;
    const claimLock = new Promise(resolve => { claimLocked=resolve; });
    const claimOne = asyncSql(`begin; set role service_role; select claim_driver_pay_calculation('concurrent-worker-one','${pendingId}'); select 'CLAIM_LOCKED'; select pg_sleep(0.4); commit;`, output=>{ if(output.includes('CLAIM_LOCKED')) claimLocked(); });
    await Promise.race([claimLock,claimOne.then(result=>{if(!result.stdout.includes('CLAIM_LOCKED')) throw new Error(result.stderr);})]);
    const claimTwo = await asyncSql(`set role service_role; select claim_driver_pay_calculation('concurrent-worker-two','${pendingId}');`);
    assert.equal(claimTwo.code,0,claimTwo.stderr);
    assert.doesNotMatch(claimTwo.stdout,/jobId/);
    assert.equal((await claimOne).code,0);
    sql(`select test_assert((select attempt_count=1 and locked_by='concurrent-worker-one' from jobs where payload->>'assignmentId'='${pendingId}'),'concurrent worker cannot steal lease or increment attempts');`);
    const jobId=sql(`select id from jobs where payload->>'assignmentId'='${pendingId}';`).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)[0];
    let finishLocked;
    const finishLock=new Promise(resolve=>{finishLocked=resolve;});
    const finishCommand=`select finish_driver_pay_calculation('${jobId}','concurrent-worker-one',300,20,'mapbox');`;
    const finishOne=asyncSql(`begin; set role service_role; ${finishCommand} select 'FINISH_LOCKED'; select pg_sleep(0.4); commit;`,output=>{if(output.includes('FINISH_LOCKED')) finishLocked();});
    await Promise.race([finishLock,finishOne.then(result=>{if(!result.stdout.includes('FINISH_LOCKED')) throw new Error(result.stderr);})]);
    const finishTwo=asyncSql(`set role service_role; ${finishCommand}`);
    const [finishedOnce,finishedAgain]=await Promise.all([finishOne,finishTwo]);
    assert.equal(finishedOnce.code,0,finishedOnce.stderr);
    assert.equal(finishedAgain.code,0,finishedAgain.stderr);
    assert.equal(finishedAgain.stdout.trim(),'f');
    sql(`select test_assert((select count(*)=1 from audit_events where entity_id='${pendingId}' and action='driver.pay_calculated'),'concurrent finish commits exactly one immutable pay snapshot');`);
    console.log('PASS: START pay preserves immutable GPS/rate/privacy; durable retry, scoped finalization and concurrent idempotency');
    if (process.env.START_PAY_AUDIT_TEST === '1') {
      const { runStartPayAuditChecks } = await import('./run-start-pay-audit-checks.mjs');
      await runStartPayAuditChecks({sql,migration,asyncSql,root});
    }
  }
  if (process.env.STAFF_DOCUMENT_TEST === '1') {
    assert.equal(process.env.AUDIT_FIX_TEST,'1','Staff documents require current hardened schema fixture');
    const { runStaffDocumentChecks }=await import('./run-staff-document-checks.mjs');
    await runStaffDocumentChecks({sql,migration,asyncSql,root});
  }
  if (process.env.IMPORT_SOURCE_TEST === '1') {
    assert.equal(process.env.STAFF_DOCUMENT_TEST,'1','Import source requires current staff document schema');
    const { runImportSourceChecks }=await import('./run-import-source-checks.mjs');
    await runImportSourceChecks({sql,migration,asyncSql,root});
  }
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
