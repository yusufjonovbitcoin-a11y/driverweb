import fs from 'node:fs/promises';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { validatePdfSource } from '../supabase/functions/_shared/pdf-source.ts';
import { runDocumentEngine } from '../supabase/functions/_shared/load-document-engine.ts';
import { extractCloudPdfSource } from '../supabase/functions/_shared/pdf-cloud-source.ts';
import { EXTRA_DOCUMENT_FIELDS, EXTRA_DOCUMENT_PROPERTIES, EXTRA_STOP_FIELDS, EXTRA_STOP_PROPERTIES } from '../supabase/functions/_shared/load-document-fields.ts';
import { documentReviewSchema } from '../supabase/functions/_shared/load-single-pass.ts';
import { EVIDENCE_PATHS } from '../supabase/functions/_shared/load-extraction-verification.ts';

const args = process.argv.slice(2);
const root = path.resolve(args.find(value => value.startsWith('--output='))?.slice(9) ?? 'output/pdf-engine-benchmark-2026-10-31');
const model = args.find(value => value.startsWith('--model='))?.slice(8) ?? 'gpt-4.1-mini';
const label = args.find(value => value.startsWith('--label='))?.slice(8) ?? 'hybrid-v2';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('INVALID_RUN_LABEL');
const selected = args.filter(value => /^\d{2}$/.test(value));
const manifestPath = args.find(value => value.startsWith('--manifest='))?.slice(11) ?? 'output/pdf-markitdown-comparison-2026-10-31/manifest.json';
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const env = await fs.readFile('.env.openai-secrets', 'utf8');
const key = env.match(/^OPENAI_API_KEY=["']?([^\r\n"']+)/m)?.[1];
if (!key) throw Error('OPENAI_API_KEY_NOT_CONFIGURED');
const production = await fs.readFile('supabase/functions/parse-load-document/index.ts', 'utf8');
const implementationHashes = {};
for (const file of ['load-document-engine.ts', 'load-document-rules.ts', 'load-document-values.ts', 'pdf-cloud-source.ts', 'pdf-source.ts', 'load-extraction-verification.ts']) {
  const bytes = await fs.readFile('supabase/functions/_shared/' + file);
  implementationHashes[file] = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}
const bindings = { EXTRA_DOCUMENT_FIELDS, EXTRA_DOCUMENT_PROPERTIES, EXTRA_STOP_FIELDS, EXTRA_STOP_PROPERTIES, documentReviewSchema, EVIDENCE_PATHS };
const code = production.slice(production.indexOf('const stopSchema ='), production.indexOf('function json('));
const schemas = Function(...Object.keys(bindings), `${stripTypeScriptTypes(code)};return {stopSchema,extractionSchema};`)(...Object.values(bindings));

for (const doc of manifest.filter(doc => !selected.length || selected.includes(doc.id))) {
  const folder = path.join(root, doc.id);
  await fs.mkdir(folder, { recursive: true });
  const destination = path.join(folder, `${model}.${label}.json`);
  try { await fs.access(destination); console.log(doc.id, model, 'already recorded'); continue; } catch {}
  const bytes = new Uint8Array(await fs.readFile(doc.path));
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  if (digest !== doc.sha256) throw Error('ORIGINAL_DOCUMENT_CHANGED');
  const record = { id: doc.id, name: doc.name, model, sha256: digest, implementationHashes,
    startedAt: new Date().toISOString(), requests: [] };
  const started = performance.now();
  try {
    const result = await runDocumentEngine({ bytes, checksum: digest, model,
      documentSchema: schemas.extractionSchema, stopSchema: schemas.stopSchema,
      parsePdf: (bytes, checksum) => extractCloudPdfSource(bytes, checksum, () => import('unpdf')),
      ocrPdf: async (bytes, checksum, pages) => {
        const python = process.env.PDF_PYTHON ?? path.resolve('tmp/markitdown-comparison-venv/Scripts/python.exe');
        const result = spawnSync(python, ['scripts/pdf_preprocessor.py', '--text-only', '--ocr-pages', pages.join(',')], {
          input: bytes, timeout: 20000, maxBuffer: 28 * 1024 * 1024,
          env: { ...process.env, TESSDATA_PREFIX: process.env.TESSDATA_PREFIX ?? path.resolve('tmp/pdf-slot-tessdata') },
        });
        if (result.status !== 0) throw Error('LOCAL_OCR_FAILED');
        return validatePdfSource(JSON.parse(result.stdout.toString('utf8')), checksum);
      },
      request: async body => {
        const start = performance.now();
        const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST',
          signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body) });
        const payload = await response.json();
        record.requests.push({ status: response.status, durationMs: performance.now() - start, usage: payload.usage,
          actualModel: payload.model, requestId: response.headers.get('x-request-id') });
        if (!response.ok) throw Error(`PROVIDER_${response.status}_${payload.error?.code ?? 'ERROR'}`);
        return payload;
      },
    });
    record.result = result;
  } catch (error) { record.error = error.message; }
  record.totalMs = performance.now() - started;
  await fs.writeFile(destination, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ id: doc.id, model, totalMs: Math.round(record.totalMs), error: record.error,
    calls: record.requests.length, tokens: record.requests.reduce((sum, request) => sum + (request.usage?.total_tokens ?? 0), 0),
    load: record.result?.verified?.safe?.loadNumber, issues: record.result?.candidate?.engineIssues }));
}
