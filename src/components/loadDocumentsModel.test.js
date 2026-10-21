import { documentViewerActionChoices } from './loadDocumentsModel.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { documentChoices, documentViewerLoad, documentActionSnapshot, documentUploadError, documentMutationError, documentWorkspaceEntries, selectedWorkspaceEntry, documentRegistryEntries, documentRegistrySummary, filterDocumentRegistry } from './loadDocumentsModel.js';

const base = { id: 'shipperBol', title: 'Shipper BOL', available: true, versionId: 'old-first', url: 'old-first-url' };
const stops = [{ id: 'pickup-a', type: 'pickup', sequence: 1, city: 'Phoenix' },
  { id: 'pickup-b', type: 'pickup', sequence: 2, city: 'Tucson' }, { id: 'delivery-a', type: 'delivery', sequence: 3 }];
const row = (id, stop, extra = {}) => ({ id, document_type: 'bol', stop_id: stop, current_version_id: `version-${id}`, fileName: `${id}.pdf`, mimeType: 'application/pdf', ...extra });

test('every current BOL at each pickup is selectable, removed rows cannot hide active files', () => {
  const choices = documentChoices(base, { stops, documentItems: [row('removed', 'pickup-a', { current_version_id: null }),
    row('a', 'pickup-a'), row('b', 'pickup-a'), row('c', 'pickup-b'), row('legacy', null)] });
  assert.deepEqual(choices.filter(choice => choice.document.available).map(choice => choice.document.documentId), ['legacy', 'a', 'b', 'c']);
  assert.deepEqual(choices.filter(choice => choice.add).map(choice => choice.document.stopId), ['pickup-a', 'pickup-b']);
  assert.equal(choices.find(choice => choice.key === 'document:b').document.versionId, 'version-b');
  assert.equal(choices.find(choice => choice.key === 'document:c').document.stopId, 'pickup-b');
  assert.ok(!choices.some(choice => choice.document.documentId === 'removed'));
});

test('POD targets deliveries; missing stop and empty exact context never reuse representative fallback', () => {
  const context = { stops, documentItems: [] };
  const pod = documentChoices({ ...base, id: 'receiverPod' }, context);
  assert.equal(pod.length, 1); assert.equal(pod[0].document.stopId, 'delivery-a');
  assert.equal(pod[0].document.available, false); assert.equal(pod[0].document.versionId, null); assert.equal(pod[0].document.url, null);
  const unavailable = documentChoices(base, { stops: [], documentItems: [] });
  assert.equal(unavailable[0].missingStop, true); assert.equal(unavailable[0].document.available, false);
  assert.equal(documentChoices(base, null)[0].document, base, 'read-only legacy view preserves its existing document');
});

test('ten active files suppress only that stop Add target; Rate Con prefers active over removed history', () => {
  const documentItems = Array.from({ length: 10 }, (_, i) => row(`a-${i}`, 'pickup-a'));
  const choices = documentChoices(base, { stops, documentItems });
  assert.equal(choices.filter(choice => choice.document.available).length, 10);
  assert.deepEqual(choices.filter(choice => choice.add).map(choice => choice.document.stopId), ['pickup-b']);
  const rate = documentChoices({ ...base, id: 'rateCon' }, { stops, documentItems: [
    row('removed-rate', null, { document_type: 'rate_confirmation', current_version_id: null }),
    row('current-rate', null, { document_type: 'rate_confirmation' }),
  ] });
  assert.equal(rate[0].document.versionId, 'version-current-rate');
});

test('viewer and mutation capture exact non-first document/version/stop without changing original load', () => {
  const load = { id: 'load-a', documents: { shipperBol: 'first-url', receipt: 'receipt-url' },
    documentMeta: { shipperBol: { id: 'first', current_version_id: 'first-version' } }, documentChecks: { shipperBol: 'approved' } };
  const document = documentChoices(base, { stops, documentItems: [row('second', 'pickup-b')] }).find(choice => choice.document.available).document;
  const viewed = documentViewerLoad(load, document);
  assert.equal(viewed.documentMeta.shipperBol.current_version_id, 'version-second');
  assert.equal(viewed.documentMeta.shipperBol.stop_id, 'pickup-b'); assert.equal(viewed.documents.shipperBol, null);
  assert.equal(viewed.documentChecks.shipperBol, null); assert.equal(viewed.documents.receipt, 'receipt-url');
  assert.equal(load.documentMeta.shipperBol.current_version_id, 'first-version');
  const action = documentActionSnapshot(load, document, 'remove', 'operation-a');
  assert.deepEqual(action, { reviewedLoad: load, type: 'bol', action: 'remove', documentId: 'second', stopId: 'pickup-b', expectedVersionId: 'version-second', operationId: 'operation-a' });
  document.versionId = 'later-version'; assert.equal(action.expectedVersionId, 'version-second');
  const add = documentActionSnapshot(load, documentChoices(base, { stops, documentItems: [] })[0].document, 'upload', 'operation-b');
  assert.equal(add.documentId, null); assert.equal(add.expectedVersionId, null); assert.equal(add.stopId, 'pickup-a');
});

test('file selection allows only matching PDF/JPEG/PNG up to 50 MiB, including empty OS MIME', () => {
  for (const [name, type] of [['file.pdf', 'application/pdf'], ['FILE.JPG', 'image/jpeg'], ['file.jpeg', 'image/jpeg'], ['file.png', 'image/png'], ['file.pdf', '']]) {
    assert.equal(documentUploadError({ name, type, size: 50 * 1024 * 1024 }), null);
  }
  assert.equal(documentUploadError({ name: 'file.pdf', type: 'application/pdf', size: 0 }), 'emptyFile');
  assert.equal(documentUploadError({ name: 'file.pdf', type: 'application/pdf', size: 50 * 1024 * 1024 + 1 }), 'fileTooLarge');
  for (const [name, type] of [['file.html', 'text/html'], ['file.webp', 'image/webp'], ['file.gif', 'image/png'], ['file.pdf', 'text/html']]) {
    assert.equal(documentUploadError({ name, type, size: 10 }), 'fileType');
  }
});

test('server failures map to localized semantic keys instead of exposing raw payloads', () => {
  for (const [code, key] of [['STAFF_DOCUMENT_FILE_INVALID', 'fileType'], ['STAFF_DOCUMENT_FILE_TOO_LARGE', 'fileTooLarge'],
    ['STAFF_DOCUMENT_BUSY', 'busyError'], ['STAFF_DOCUMENT_CONFLICT', 'conflict'], ['STAFF_DOCUMENT_REQUEST_ABORTED', 'timeoutError'],
    ['STAFF_DOCUMENT_REQUEST_TIMEOUT', 'timeoutError'], ['STAFF_DOCUMENT_PERMISSION_DENIED', 'permissionError'],
    ['STAFF_DOCUMENT_UPLOAD_EXPIRED', 'uploadExpired'], ['STAFF_DOCUMENT_STOP_REQUIRED', 'stopRequired'],
    ['STAFF_DOCUMENT_STOP_INVALID', 'stopInvalid'], ['STAFF_DOCUMENT_LIMIT_REACHED', 'limitReached'], ['LOAD_TRASHED', 'loadTrashed'],
    ['STAFF_DOCUMENT_INVALID_RESULT', 'saveError']]) assert.equal(documentMutationError({ code: 'P0001', message: code }), key);
  assert.equal(documentMutationError({ status: 403 }), 'permissionError');
  assert.equal(documentMutationError(new Error('private backend detail')), 'saveError');
});


test('viewer mutations target only the displayed document and exact version', () => {
  const context = { stops: [{ id: 'p1', type: 'pickup', sequence: 1 }, { id: 'p2', type: 'pickup', sequence: 2 }],
    documentItems: [{ id: 'first', document_type: 'bol', stop_id: 'p1', current_version_id: 'v1' },
      { id: 'second', document_type: 'bol', stop_id: 'p2', current_version_id: 'v2' }] };
  const base = { id: 'shipperBol', available: true, documentId: 'second', versionId: 'v2' };
  const choices = documentViewerActionChoices(base, context);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].document.stopId, 'p2');
  assert.equal(documentViewerActionChoices({ ...base, versionId: 'superseded' }, context).length, 0);
  assert.equal(documentViewerActionChoices({ id: 'shipperBol', available: true }, context).length, 0);
  assert.deepEqual(documentViewerActionChoices({ id: 'shipperBol', available: false }, context).map(choice => choice.document.stopId), ['p1', 'p2']);
});

test('workspace lists independent files and add targets for multiple pickups and deliveries', () => {
  const context = { stops: [...stops, { id: 'delivery-b', type: 'delivery', sequence: 4, city: 'Dallas' }],
    documentItems: [row('a', 'pickup-a'), row('b', 'pickup-b'), row('c', 'pickup-b'),
      row('pod-a', 'delivery-a', { document_type: 'pod' }), row('pod-b', 'delivery-b', { document_type: 'pod' }),
      row('receipt', null, { document_type: 'receipt' })] };
  const entries = documentWorkspaceEntries([base, { ...base, id: 'receiverPod' }, { ...base, id: 'receipt' }], context);
  assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length);
  assert.deepEqual(entries.filter(entry => entry.document.available).map(entry => [entry.document.documentId, entry.marker]),
    [['a', 'P1'], ['b', 'P2'], ['c', 'P2'], ['pod-a', 'D1'], ['pod-b', 'D2'], ['receipt', null]]);
  assert.deepEqual(entries.filter(entry => entry.add).map(entry => [entry.document.id, entry.document.stopId]),
    [['shipperBol', 'pickup-a'], ['shipperBol', 'pickup-b'], ['receiverPod', 'delivery-a'], ['receiverPod', 'delivery-b']]);
  const selected = selectedWorkspaceEntry(entries, 'receiverPod:document:pod-b');
  assert.equal(selected.document.versionId, 'version-pod-b');
  assert.equal(documentActionSnapshot({}, selected.document, 'remove').stopId, 'delivery-b');
});

test('selection survives replacement and safely falls back after removal; file metadata is retained', () => {
  const context = { stops, documentItems: [row('a', 'pickup-b', { current_version_id: 'new-a', sizeBytes: 1024, uploadedAt: '2026-10-21T00:00:00Z' })] };
  const entries = documentWorkspaceEntries([base], context);
  const selected = selectedWorkspaceEntry(entries, 'shipperBol:document:a');
  assert.equal(selected.document.versionId, 'new-a');
  assert.equal(selected.document.sizeBytes, 1024);
  assert.equal(selected.document.uploadedAt, '2026-10-21T00:00:00Z');
  const empty = documentWorkspaceEntries([base], { stops, documentItems: [] });
  assert.equal(selectedWorkspaceEntry(empty, selected.key).document.available, false);
  assert.equal(selectedWorkspaceEntry(empty, selected.key).document.versionId, null);
  assert.equal(selectedWorkspaceEntry([], null), null);
});

test('registry counts stop coverage without counting another-file targets as missing documents', () => {
  const entries = documentWorkspaceEntries([base, { id: 'receiverPod' }, { id: 'receipt' }], { stops,
    documentItems: [row('a', 'pickup-a'), row('b', 'pickup-a'), row('c', 'pickup-b')] });
  const rows = documentRegistryEntries(entries);
  assert.equal(rows.filter(entry => entry.add).length, 1, 'only delivery is missing; occupied pickup Add slots are hidden');
  assert.equal(rows.length, 5);
  assert.deepEqual(documentRegistrySummary(entries), { total: 4, uploaded: 2, pending: 2, percent: 50 });
  const addKey = entries.find(entry => entry.add && entry.document.stopId === 'pickup-b').key;
  assert.equal(documentRegistryEntries(entries, addKey).length, 6);
});

test('registry searches non-first stop/files and filters/sorts without mutating the source', () => {
  const entries = documentRegistryEntries(documentWorkspaceEntries([base, { id: 'receiverPod' }], { stops,
    documentItems: [row('z-file', 'pickup-a', { sizeBytes: 200 }), row('a-file', 'pickup-b', { sizeBytes: 100 })] }));
  assert.deepEqual(filterDocumentRegistry(entries, { query: 'tucson' }).map(entry => entry.document.documentId), ['a-file']);
  assert.deepEqual(filterDocumentRegistry(entries, { query: 'P2' }).map(entry => entry.document.documentId), ['a-file']);
  assert.equal(filterDocumentRegistry(entries, { query: 'does-not-exist' }).length, 0);
  assert.equal(filterDocumentRegistry(entries, { filter: 'pending' }).length, 1);
  assert.deepEqual(filterDocumentRegistry(entries, { filter: 'uploaded', sort: 'size', direction: -1 }).map(entry => entry.document.documentId), ['z-file', 'a-file']);
  assert.deepEqual(filterDocumentRegistry(entries, { filter: 'uploaded', sort: 'file' }).map(entry => entry.document.documentId), ['a-file', 'z-file']);
  assert.equal(entries[0].document.documentId, 'z-file');
});
