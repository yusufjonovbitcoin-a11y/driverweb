import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'drivex-brief-test-'));
const pgBin = process.env.PG_BIN || '';
function run(binary, args) {
  const result = spawnSync(path.join(pgBin, binary), args, { stdio: 'inherit', cwd: root });
  if (result.error || result.status !== 0) throw result.error || new Error(`${binary} failed: ${result.status}`);
}
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55440`, 'start']);
  started = true;
  run('psql', ['-h', directory, '-p', '55440', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-f', 'scripts/driver-brief-test-fixtures/bootstrap.sql',
    '-f', 'supabase/migrations/20261001150028_direct_driver_assignment.sql',
    '-f', 'supabase/migrations/20261001220059_verified_driver_brief.sql',
    '-f', 'scripts/driver-brief-test-fixtures/checks.sql']);
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
