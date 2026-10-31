import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = await mkdtemp(path.join(tmpdir(), 'driver-earnings-db-'));
if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(directory).startsWith('driver-earnings-db-')) throw Error('Invalid cleanup directory');
const pgBin = process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
function run(name, args) {
  const result = spawnSync(path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : '')), args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || Error(name + ' failed');
}
let started = false;
try {
  run('initdb', ['-D', directory + '/data', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', directory + '/data', '-l', directory + '/server.log', '-o', '-h 127.0.0.1 -p 55451', 'start']);
  started = true;
  run('psql', ['-h', '127.0.0.1', '-p', '55451', '-U', process.env.USERNAME || process.env.USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', 'tests/earnings/bootstrap.sql', '-f', 'supabase/migrations/20261024014338_driver_earnings_delivery.sql', '-f', 'supabase/migrations/20261024015017_earnings_recipient_isolation.sql', '-f', 'tests/earnings/checks.sql']);
} finally {
  if (started) run('pg_ctl', ['-D', directory + '/data', '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
