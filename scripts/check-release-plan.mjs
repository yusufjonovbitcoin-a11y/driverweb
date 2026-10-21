import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Read-only guard: the operator supplies a fresh export of the target ledger.
// It does not connect, repair migration history, or execute SQL.
export function validateReleasePlan({ projectRef, capturedAt, appliedVersions, approvedPendingVersions }, localFiles, now = Date.now()) {
  if (projectRef !== 'gsnbjpqwwpvqtmphsyfs') throw new Error('Target project does not match DriverWeb');
  const age = now - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 3_600_000) throw new Error('A ledger export less than one hour old is required');
  if (!Array.isArray(appliedVersions) || !Array.isArray(approvedPendingVersions) ||
      ![...appliedVersions, ...approvedPendingVersions].every(value => typeof value === 'string' && /^\d{12,14}$/.test(value))) {
    throw new Error('Explicit appliedVersions and approvedPendingVersions arrays are required');
  }
  const applied = new Set(appliedVersions);
  const pending = localFiles.filter(name => !applied.has(name.split('_')[0]));
  // This historical reset must never run against an existing deployment.
  if (pending.some(name => name.includes('clear_operational_data_keep_users'))) throw new Error('STOP: historical operational reset is pending; reconcile the ledger before any deploy');
  const actual = pending.map(name => name.split('_')[0]).sort();
  const approved = [...new Set(approvedPendingVersions)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(approved)) throw new Error('Pending migrations differ from the explicitly reviewed release plan');
  return pending;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/check-release-plan.mjs /secure/path/ledger-export.json');
  const ledger = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => /^\d+_.*\.sql$/.test(name));
  const pending = validateReleasePlan(ledger, files);
  console.log(`PASS: ${pending.length} reviewed pending migrations. Backup/restore and dry-run evidence still required.`);
}
