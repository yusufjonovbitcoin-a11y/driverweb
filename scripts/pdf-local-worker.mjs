// Local-only service wrapper. Its random token and Python runtime stay in the
// ignored .venv directory and are never passed to Vite or printed in logs.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = resolve(root, '.venv/pdf/bin/python');
const tessdata = resolve(root, '.venv/pdf/tessdata');
const tokenPath = resolve(root, '.venv/pdf-worker.token');
const checking = process.argv[2] === '--check';
if (!existsSync(python) || !existsSync(resolve(tessdata, 'eng.traineddata'))) {
  console.error('PDF runtime or English OCR data missing. See docs/pdf-source-grounding.md.');
  process.exit(1);
}
if (!checking && !existsSync(tokenPath)) {
  writeFileSync(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
}
chmodSync(tokenPath, 0o600);
const token = readFileSync(tokenPath, 'utf8').trim();
if (token.length < 32) throw Error('Invalid local PDF worker token');

if (checking) {
  const path = process.argv[3];
  if (!path) throw Error('Usage: npm run pdf:check -- /absolute/path/to/document.pdf');
  const data = readFileSync(path);
  const denied = await fetch('http://127.0.0.1:8788/preprocess', {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: data, signal: AbortSignal.timeout(5000),
  });
  if (denied.status !== 401) throw Error('Worker authentication check failed');
  const started = performance.now();
  const response = await fetch('http://127.0.0.1:8788/preprocess', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
    body: data, signal: AbortSignal.timeout(65000),
  });
  if (!response.ok) throw Error(`Worker returned HTTP ${response.status}`);
  const source = await response.json();
  console.log(JSON.stringify({ running: true, authenticated: true, pages: source.pageCount,
    blocks: source.pages.reduce((n, p) => n + p.blocks.length, 0), elapsedMs: Math.round(performance.now() - started) }));
} else {
  const child = spawn(python, [resolve(root, 'scripts/pdf_preprocessor.py'), '--serve'], {
    cwd: root, stdio: 'inherit',
    env: { PATH: '/usr/bin:/bin', PYTHONUNBUFFERED: '1', TESSDATA_PREFIX: tessdata,
      PDF_PREPROCESSOR_TOKEN: token, PDF_PREPROCESSOR_PORT: '8788' },
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Could not start PDF worker'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 0; });
}
