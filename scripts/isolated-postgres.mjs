import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const postgresHost = directory => process.platform === 'win32' ? '127.0.0.1' : directory;
export const postgresStartOptions = (directory, port, extra = '') =>
  `${process.platform === 'win32' ? '-h 127.0.0.1' : `-k "${directory}" -h ''`} -p ${port} ${extra}`;
export const normalizePostgresOutput = value => value?.replaceAll('\r\n', '\n') || '';
export function postgresSpawnOptions(binary, options = {}) {
  return { ...options, ...(process.platform === 'win32' && binary === 'pg_ctl' ? { stdio: 'ignore' } : {}) };
}
export async function removeTestCluster(directory) {
  const absolute = path.resolve(directory), relative = path.relative(path.resolve(tmpdir()), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
    || !/^(drivex-|tfleets-)/.test(path.basename(absolute))) throw Error('Refusing unexpected test-cluster cleanup target');
  await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// No production connection strings or app credentials are read by this harness.
export async function withIsolatedPostgres(callback, { port = 55450 } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), 'tfleets-settlement-test-'));
  const bin = process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  const connection = ['-h', postgresHost(directory), '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
  function run(binary, args, input) {
    const result = spawnSync(path.join(bin, binary), args, postgresSpawnOptions(binary, { cwd: root, input, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }));
    if (result.error || result.status !== 0) throw result.error || Error(result.stderr || result.stdout || `${binary} failed`);
    return normalizePostgresOutput(result.stdout);
  }
  let started = false;
  try {
    run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
    run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', postgresStartOptions(directory, port), 'start']);
    started = true;
    await callback({ sql: value => run('psql', connection, value), root, connection, bin });
  } finally {
    if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
    await removeTestCluster(directory);
  }
}
