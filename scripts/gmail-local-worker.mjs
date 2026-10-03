import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRef = process.env.GMAIL_SUPABASE_PROJECT_REF?.trim();
const companyId = process.env.GMAIL_COMPANY_ID?.trim();
if (!projectRef || !companyId) {
  console.error('GMAIL_SUPABASE_PROJECT_REF and GMAIL_COMPANY_ID are required');
  process.exit(1);
}

function readCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} credential lookup failed`);
  }
  return result.stdout.trim();
}

try {
  const keys = JSON.parse(readCommand('/opt/homebrew/bin/supabase', [
    'projects', 'api-keys', '--project-ref', projectRef, '--reveal', '--output', 'json',
  ]));
  const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key;
  const workerToken = readCommand('/usr/bin/security', [
    'find-generic-password', '-w', '-s', 'com.drivex.gmail-worker', '-a', projectRef,
  ]);
  if (!serviceKey || !workerToken) throw new Error('Worker credentials are missing');

  const script = resolve(dirname(fileURLToPath(import.meta.url)), 'gmail-imap-sync.mjs');
  const child = spawn(process.execPath, [script], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    env: {
      ...process.env,
      GMAIL_COMPANY_ID: companyId,
      GMAIL_WORKER_TOKEN: workerToken,
      SUPABASE_URL: `https://${projectRef}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      GMAIL_MAX_MESSAGES: process.env.GMAIL_MAX_MESSAGES || '25',
      CLOUDINARY_REQUIRED: 'true',
    },
    stdio: 'inherit',
  });
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
