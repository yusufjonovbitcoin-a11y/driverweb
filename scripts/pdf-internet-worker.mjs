// Temporary Mac-hosted HTTPS transport. No browser credentials or service-role
// keys. Supabase CLI uses the user's existing authenticated management session.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.PDF_SUPABASE_PROJECT_REF;
if (!/^[a-z]{20}$/.test(project || '')) throw Error('PDF_SUPABASE_PROJECT_REF is required');
const token = readFileSync(resolve(root, '.venv/pdf-worker.token'), 'utf8').trim();
if (token.length < 32) throw Error('Local PDF worker must be initialized first');
const statePath = resolve(root, '.venv/pdf-tunnel.json');
const envPath = resolve(root, '.venv/pdf-worker-supabase.env');
let stopping = false;
let configured = false;
const tunnel = spawn('/opt/homebrew/bin/cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2',
  '--url', 'http://127.0.0.1:8788'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

async function configure(origin) {
  for (let attempt = 0; attempt < 18 && !stopping; attempt++) {
    try {
      const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok || (await response.json()).service !== 'drivex-pdf') throw Error('Worker not ready');
      // The ignored owner-only file keeps secrets out of process arguments/logs.
      writeFileSync(envPath, `PDF_PREPROCESSOR_URL=${origin}/preprocess\nPDF_PREPROCESSOR_TOKEN=${token}\n`, { mode: 0o600 });
      let result;
      try {
        result = spawnSync('/opt/homebrew/bin/supabase', ['secrets', 'set', '--project-ref', project, '--env-file', envPath],
          { cwd: root, encoding: 'utf8', timeout: 30000 });
      } finally { unlinkSync(envPath); }
      if (result.error || result.status !== 0) throw Error('Supabase worker secret update failed');
      writeFileSync(statePath, JSON.stringify({ origin, project, configuredAt: new Date().toISOString() }), { mode: 0o600 });
      configured = true;
      console.log('PDF HTTPS tunnel ready; Supabase endpoint updated.');
      return;
    } catch {
      if (attempt === 17) { console.error('PDF HTTPS tunnel configuration failed; inspect local service and Supabase CLI login.'); tunnel.kill(); return; }
      await delay(5000);
    }
  }
}
let started = false;
let buffer = '';
function output(chunk) {
  buffer = (buffer + chunk.toString()).slice(-16000);
  const match = buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);
  if (match && !started) { started = true; void configure(match[0]); }
  // Do not relay raw subprocess output or credentials to logs.
}
tunnel.stdout.on('data', output);
tunnel.stderr.on('data', output);
tunnel.on('error', () => { console.error('Could not start cloudflared'); process.exitCode = 1; });
tunnel.on('exit', () => { stopping = true; process.exitCode = configured ? 0 : 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; tunnel.kill(signal); });
