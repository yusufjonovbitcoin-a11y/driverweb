import { createHash } from 'node:crypto';
import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Offline, read-only verification. It never connects to Supabase or repairs a ledger.
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'supabase/migration-ledger/2026-10-07.json'), 'utf8'));
const digest = value => createHash('sha256').update(value.trim()).digest('hex');
const exists = async name => access(name).then(() => true, () => false);
assert.equal(manifest.projectRef, 'gsnbjpqwwpvqtmphsyfs');
for (const entry of manifest.canonicalMigrations) {
  assert.equal(digest(await readFile(path.join(root, 'supabase/migrations', entry.canonicalFile), 'utf8')), entry.trimmedSqlSha256, `SQL changed: ${entry.canonicalFile}`);
  assert.equal(await exists(path.join(root, 'supabase/migrations', entry.previousFile)), false, `Duplicate historical version: ${entry.previousFile}`);
}
const contract = manifest.unrecordedContract;
const source = await readFile(path.join(root, contract.historyFile), 'utf8');
assert.equal(digest(source), contract.trimmedSqlSha256);
const forward = await readFile(path.join(root, 'supabase/migrations', contract.forwardFile), 'utf8');
assert.equal(digest(forward), contract.forwardTrimmedSqlSha256);
// The sole forward correction is explicit; retain exact historical evidence.
assert.equal(forward.replace("|| (target.driver_brief->'blockingFields')", "|| target.driver_brief->'blockingFields'").trim(), source.trim());
assert.equal(await exists(path.join(root, 'supabase/migrations', contract.previousFile)), false);
const oldNames = [...manifest.canonicalMigrations.map(entry => entry.previousFile), contract.previousFile];
async function checkReferences(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkReferences(filename);
    else if (/\.(?:mjs|js|ts|sql|ya?ml)$/.test(entry.name)) {
      const source = await readFile(filename, 'utf8');
      for (const previous of oldNames) assert(!source.includes(previous), `Stale migration reference in ${filename}: ${previous}`);
    }
  }
}
await checkReferences(path.join(root, 'scripts'));
await checkReferences(path.join(root, 'supabase/tests'));
console.log(`PASS: ${manifest.canonicalMigrations.length} canonical migration hashes, forward contract and test references; no network or ledger writes`);
