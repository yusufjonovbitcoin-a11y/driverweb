// Reuses recorded provider responses, never calls an API or reads answer keys.
// Keep the original run, its failed retries and all incurred time/tokens intact.
import fs from 'node:fs/promises';
import { decodeDocumentEngine } from '../supabase/functions/_shared/load-document-engine.ts';
import { verifyLoadExtraction } from '../supabase/functions/_shared/load-extraction-verification.ts';
import { validatePdfSource } from '../supabase/functions/_shared/pdf-source.ts';

const hashes = {};
for (const file of ['load-document-engine.ts', 'load-document-rules.ts', 'load-document-values.ts', 'load-extraction-verification.ts']) {
  hashes[file] = Buffer.from(await crypto.subtle.digest('SHA-256', await fs.readFile('supabase/functions/_shared/' + file))).toString('hex');
}
for (const root of ['output/pdf-engine-benchmark-2026-10-31', 'output/pdf-engine-synthetic-2026-10-31']) {
  for (const folder of (await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d\d$/.test(entry.name))) {
    for (const file of (await fs.readdir(root + '/' + folder.name)).filter(file => file.endsWith('.final.json'))) {
      const run = JSON.parse(await fs.readFile(`${root}/${folder.name}/${file}`, 'utf8'));
      if (!run.result) continue;
      const start = performance.now();
      const source = validatePdfSource(run.result.candidate.sourceManifest, run.sha256);
      const candidate = decodeDocumentEngine(structuredClone(run.result.wire), source);
      const verified = verifyLoadExtraction(candidate, null, true);
      await fs.writeFile(`${root}/${folder.name}/${file.replace('.final.json', '.validation.json')}`,
        JSON.stringify({ originalRun: file, validationHashes: hashes, validationMs: performance.now() - start,
          evaluatedAt: new Date().toISOString(), candidate, verified }, null, 2));
    }
  }
}
console.log('Recorded supplemental source verification without additional model requests.');
