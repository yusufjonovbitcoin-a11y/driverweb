import test from 'node:test';
import assert from 'node:assert/strict';
import { hasLoadDocument } from './loadDocumentAvailability.js';
import { buildGlobalSearchResults } from '../utils/globalSearch.js';

test('all four document types remain available before URL signing', () => {
  for (const type of ['rateCon', 'shipperBol', 'receiverPod', 'receipt']) {
    assert.equal(hasLoadDocument({ documentMeta: { [type]: { current_version_id: 'v1' } } }, type), true);
    assert.equal(hasLoadDocument({ documents: { [type]: 'legacy-url' } }, type), true);
    assert.equal(hasLoadDocument({ documentMeta: { [type]: {} } }, type), false);
    assert.equal(hasLoadDocument(null, type), false);
  }
});

test('global search finds documents with durable IDs and no signed URLs', () => {
  const load = { id: 'one', loadNumber: '123', documentMeta: { shipperBol: { current_version_id: 'v1' } } };
  const results = buildGlobalSearchResults({ query: 'BOL', loads: [load] });
  assert.ok(results.some(result => result.entityId === 'one'));
});
