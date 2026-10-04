import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoadImportResult } from './loadImportResult.js';
import { reusableLoadImport } from '../../supabase/functions/_shared/load-import-cache.ts';
import { localizedError } from '../i18n/errors.js';

test('pending and unavailable results have specific messages, not an unreadable-document error', () => {
  assert.equal(localizedError(key => key, new Error('IMPORT_STILL_PROCESSING')), 'importReview.stillProcessing');
  assert.equal(localizedError(key => key, new Error('IMPORT_STATUS_UNAVAILABLE')), 'importReview.resultUnavailable');
});

const ready = { status: 'needs_review', load_id: 'load-1', extraction_schema_version: 9,
  extracted_result: { review: { blockingFields: ['pickup.addressLine'] } },
  raw_extraction: { candidate: { sourceManifest: { checksum: 'same-pdf' } } } };

test('review warnings reuse extraction without another AI call; stale/different sources do not', () => {
  assert.equal(reusableLoadImport(ready, 9, 'same-pdf', true), true);
  for (const row of [{ ...ready, status: 'processing' }, { ...ready, status: 'parse_failed' },
    { ...ready, extracted_result: null }, { ...ready, load_id: null }]) {
    assert.equal(reusableLoadImport(row, 9, 'same-pdf', true), false);
  }
  assert.equal(reusableLoadImport(ready, 10, 'same-pdf', true), false);
  assert.equal(reusableLoadImport(ready, 9, 'other-pdf', true), false);
});

test('concurrent upload waits for existing review result instead of displaying analysis failure', async () => {
  let reads = 0, pauses = 0;
  const result = await resolveLoadImportResult({ processing: true, importId: 'import-1' }, async id => {
    assert.equal(id, 'import-1'); return { data: ++reads === 1 ? { status: 'processing' } : ready };
  }, { pause: async () => { pauses++; } });
  assert.equal(reads, 2); assert.equal(pauses, 1);
  assert.equal(result.loadId, 'load-1'); assert.equal(result.duplicate, true);
  assert.deepEqual(result.preparedLoad.review.blockingFields, ['pickup.addressLine']);
});

test('ready result never polls; failure, missing record and bounded wait remain explicit', async () => {
  const initial = { loadId: 'load-1', preparedLoad: ready.extracted_result };
  assert.equal(await resolveLoadImportResult(initial, () => assert.fail()), initial);
  const pending = { processing: true, importId: 'import-1' };
  await assert.rejects(resolveLoadImportResult(pending, async () => ({ data: { status: 'parse_failed', error_message: 'PDF_PREPROCESS_FAILED' } })), /PDF_PREPROCESS_FAILED/);
  await assert.rejects(resolveLoadImportResult(pending, async () => ({ data: null })), /IMPORT_STATUS_UNAVAILABLE/);
  await assert.rejects(resolveLoadImportResult(pending, async () => ({ error: new Error('permission denied') })), /permission denied/);
  await assert.rejects(resolveLoadImportResult(pending, async () => ({ data: { status: 'processing' } }), { timeoutMs: 0 }), /IMPORT_STILL_PROCESSING/);
});
