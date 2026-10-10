import assert from 'node:assert/strict';
import test from 'node:test';
import { documentChoices, documentViewerLoad, documentActionSnapshot, documentUploadError, documentMutationError } from './loadDocumentsModel.js';

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
