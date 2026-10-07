import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Always creates its own cluster; never reads production DATABASE_URL or app credentials.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'drivex-chat-test-'));
const pgBin = process.env.PG_BIN || '';
function run(binary, args) {
  const result = spawnSync(path.join(pgBin, binary), args, { stdio: 'inherit', cwd: root });
  if (result.error || result.status !== 0) throw result.error || new Error(`${binary} failed: ${result.status}`);
}
function runSql(sql, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(path.join(pgBin, 'psql'), [
      '-h', directory, '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atqc', sql,
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error('Isolated chat concurrency check timed out'));
    }, 10_000);
    process.stdout.on('data', (chunk) => { stdout += chunk; onOutput(stdout); });
    process.stderr.on('data', (chunk) => { stderr += chunk; });
    process.on('error', (error) => { clearTimeout(timeout); reject(error); });
    process.on('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
}
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55439 -c wal_level=logical`, 'start']);
  started = true;
  run('psql', ['-h', directory, '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-f', 'scripts/chat-test-fixtures/bootstrap.sql',
    '-f', 'supabase/migrations/20261001141119_chat_reliability_hardening.sql',
    '-f', 'scripts/chat-test-fixtures/checks.sql',
    '-f', 'supabase/migrations/20261004234608_chat_consistency_and_privacy.sql',
    '-f', 'scripts/chat-test-fixtures/consistency-checks.sql',
    '-f', 'scripts/chat-test-fixtures/privacy-checks.sql',
    '-f', 'supabase/migrations/20261005120609_chat_upload_lifecycle_and_worker_capacity.sql',
    '-f', 'scripts/chat-test-fixtures/upload-lifecycle-checks.sql']);

  // Two independent sessions: the shared dispatcher cannot be booked by two
  // different driver conversations, even before the first transaction commits.
  let firstHasLock;
  const locked = new Promise((resolve) => { firstHasLock = resolve; });
  const first = runSql(`
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
    select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id;
    select 'FIRST_CALL_LOCKED';
    select pg_sleep(0.4);
    commit;
  `, (output) => { if (output.includes('FIRST_CALL_LOCKED')) firstHasLock(); });
  await Promise.race([locked, first.then((result) => {
    if (!result.stdout.includes('FIRST_CALL_LOCKED')) throw new Error(result.stderr || 'First call did not acquire its lock');
  })]);
  const second = runSql(`
    set role authenticated;
    set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
    select (start_chat_call('00000000-0000-0000-0000-000000000012','audio')).id;
  `);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.code, 0, firstResult.stderr);
  assert.notEqual(secondResult.code, 0, 'Concurrent call must be refused');
  assert.match(secondResult.stderr, /CHAT_USER_BUSY/);
  const verification = await runSql(`
    select test_assert((select count(*) from chat_calls where status in ('ringing','accepted'))=1,
      'concurrent cross-conversation call starts serialize by participant');
  `);
  assert.equal(verification.code, 0, verification.stderr);
  console.log('PASS: two concurrent callers cannot book the same participant');

  const uploadPath = '00000000-0000-0000-0000-000000000020/00000000-0000-0000-0000-000000000010/concurrent/file.pdf';
  const setupUpload = await runSql(`
    set role authenticated;
    set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
    select register_chat_media_upload('${uploadPath}');
    reset role;
    insert into storage.objects(bucket_id,name,owner_id) values('chat-media','${uploadPath}','00000000-0000-0000-0000-000000000001');
    update chat_pending_uploads set expires_at=now()-interval '1 second' where storage_path='${uploadPath}';
  `);
  assert.equal(setupUpload.code, 0, setupUpload.stderr);
  let uploadHasLock;
  const uploadLocked = new Promise((resolve) => { uploadHasLock = resolve; });
  const commitUpload = runSql(`
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
    select (send_chat_message('00000000-0000-0000-0000-000000000010','file',null,'${uploadPath}')).id;
    select 'UPLOAD_COMMIT_LOCKED';
    select pg_sleep(0.4);
    commit;
  `, (output) => { if (output.includes('UPLOAD_COMMIT_LOCKED')) uploadHasLock(); });
  await Promise.race([uploadLocked, commitUpload.then((result) => {
    if (!result.stdout.includes('UPLOAD_COMMIT_LOCKED')) throw new Error(result.stderr || 'Upload did not acquire lock');
  })]);
  const concurrentSweep = await runSql('select queue_expired_chat_uploads(100);');
  assert.equal(concurrentSweep.code, 0, concurrentSweep.stderr);
  assert.equal(concurrentSweep.stdout.trim(), '0', 'cleanup skips a concurrently committing upload');
  const committed = await commitUpload;
  assert.equal(committed.code, 0, committed.stderr);
  const afterCommit = await runSql(`
    select test_assert(queue_expired_chat_uploads(100)=0,'committed upload is not queued later');
    select test_assert((select state='attached' from chat_pending_uploads where storage_path='${uploadPath}'),'concurrent commit retains the object');
  `);
  assert.equal(afterCommit.code, 0, afterCommit.stderr);
  console.log('PASS: orphan cleanup cannot race a successful chat-media commit');
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
