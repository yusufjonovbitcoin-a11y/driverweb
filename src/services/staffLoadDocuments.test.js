import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStaffDocumentResult, createStaffDocumentManager, fetchStaffLoadDocumentContext,
  refreshOpenDocumentLoad, STAFF_DOCUMENT_MAX_BYTES, validateStaffDocumentFile } from './staffLoadDocuments.js';

const pdf = () => new File(['%PDF-1.7\nfixture'], 'confirmation.pdf', { type: 'application/pdf' });
const load = { id: 'load-a', rate: 1000, version: 12, driverBrief: { route: 'unchanged' } };
const row = { id: 'doc-a', load_id: 'load-a', document_type: 'rate_confirmation', current_version_id: 'version-new' };
const uploadRequest = file => ({ type: 'ratecon', action: 'upload', documentId: 'doc-a', expectedVersionId: 'version-old', file });
const rejected = message => ({ data: null, error: new Error(message) });
function fixture({ rpcResult, upload } = {}) {
  const calls = []; let owner = 'staff-a', counter = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: owner } } } }) },
    rpc(name, params) {
      calls.push({ name, params });
      const result = rpcResult?.(name, params) ?? { data: name === 'begin_staff_document_upload'
        ? { versionId: 'version-new', documentId: 'doc-a' } : row, error: null };
      return { abortSignal: () => Promise.resolve(result) };
    },
  };
  const manager = createStaffDocumentManager({ client, ownerId: owner, timeoutMs: 40, uuid: () => `op-${++counter}`,
    uploadMedia: async args => { calls.push({ name: 'upload', args }); return upload?.(args) ?? { reference: 'cloudinary:new-private-media' }; } });
  return { manager, calls, changeOwner: next => { owner = next; } };
}

test('validates signatures, allowed type and 50 MiB limit before writes', async () => {
  assert.equal((await validateStaffDocumentFile(pdf())).mimeType, 'application/pdf');
  for (const [bytes, name, mime] of [
    [[255, 216, 255, 0], 'x.jpeg', 'image/jpeg'], [[137,80,78,71,13,10,26,10], 'x.png', 'image/png'],
  ]) assert.equal((await validateStaffDocumentFile(new File([new Uint8Array(bytes)], name, { type: mime }))).mimeType, mime);
  for (const file of [new File([], 'x.pdf'), new File(['<script/>'], 'x.pdf', { type: 'application/pdf' }),
    new File(['%PDF-1.7'], 'x.exe'), new File(['%PDF-1.7'], 'x.pdf', { type: 'image/png' })]) {
    await assert.rejects(validateStaffDocumentFile(file), /FILE_INVALID/);
  }
  await assert.rejects(validateStaffDocumentFile({ size: STAFF_DOCUMENT_MAX_BYTES + 1, slice() {} }), /FILE_TOO_LARGE/);
  const f = fixture();
  await assert.rejects(f.manager.run(load, uploadRequest(new File(['bad'], 'x.pdf'))), /FILE_INVALID/);
  assert.equal(f.calls.length, 0);
});

test('replacement stages and uploads before atomic commit, never deletes old file', async () => {
  const f = fixture(), file = pdf();
  const result = await f.manager.run(load, uploadRequest(file));
  assert.deepEqual(f.calls.map(c => c.name), ['begin_staff_document_upload', 'upload', 'complete_staff_document_upload']);
  assert.equal(f.calls[0].params.p_expected_current_version_id, 'version-old');
  assert.equal(f.calls[0].params.p_document_type, 'rate_confirmation');
  assert.equal(f.calls[1].args.contextId, 'version-new');
  assert.equal(f.calls[1].args.scope, 'load_document');
  assert.equal(f.calls[2].params.p_media_ref, 'cloudinary:new-private-media');
  assert.equal(result.fileName, file.name);
});

test('lost completion response retries the exact staged version and media only', async () => {
  let finishes = 0;
  const f = fixture({ rpcResult: name => name === 'complete_staff_document_upload' && ++finishes === 1 ? rejected('network lost') : undefined });
  const request = uploadRequest(pdf());
  await assert.rejects(f.manager.run(load, request), /network lost/);
  await f.manager.run(load, request);
  assert.equal(f.calls.filter(c => c.name === 'upload').length, 1);
  assert.equal(f.calls.filter(c => c.name === 'begin_staff_document_upload').length, 1);
  const commits = f.calls.filter(c => c.name === 'complete_staff_document_upload');
  assert.deepEqual(commits[0].params, commits[1].params);
});

test('lost begin response reuses the operation UUID and expected version', async () => {
  let begins = 0;
  const f = fixture({ rpcResult: name => name === 'begin_staff_document_upload' && ++begins === 1 ? rejected('network lost') : undefined });
  const request = uploadRequest(pdf());
  await assert.rejects(f.manager.run(load, request));
  await f.manager.run(load, request);
  const calls = f.calls.filter(c => c.name === 'begin_staff_document_upload');
  assert.deepEqual(calls[0].params, calls[1].params);
});

test('upload failure leaves current document alone; later retry reuses staged intent', async () => {
  let uploads = 0;
  const f = fixture({ upload: () => { if (++uploads === 1) throw Error('offline'); } });
  const request = uploadRequest(pdf());
  await assert.rejects(f.manager.run(load, request), /offline/);
  assert.equal(f.calls.some(c => c.name === 'complete_staff_document_upload'), false);
  await f.manager.run(load, request);
  assert.equal(f.calls.filter(c => c.name === 'begin_staff_document_upload').length, 1);
});

test('account switching after upload prevents binding under another account', async () => {
  const f = fixture({ upload: () => { f.changeOwner('other'); return { reference: 'cloudinary:new' }; } });
  await assert.rejects(f.manager.run(load, uploadRequest(pdf())), /PERMISSION_DENIED/);
  assert.equal(f.calls.some(c => c.name === 'complete_staff_document_upload'), false);
});

test('disposed and unauthorized manager performs no writes', async () => {
  const f = fixture(); f.manager.dispose();
  await assert.rejects(f.manager.run(load, uploadRequest(pdf())), /REQUEST_ABORTED/);
  const g = fixture(); g.changeOwner('other');
  await assert.rejects(g.manager.run(load, uploadRequest(pdf())), /PERMISSION_DENIED/);
  assert.equal(f.calls.length + g.calls.length, 0);
});

test('a concurrent click cannot stage a second document operation', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const upload = new Promise(resolve => { release = resolve; });
  const f = fixture({ upload: () => { entered(); return upload; } });
  const first = f.manager.run(load, uploadRequest(pdf()));
  await started;
  await assert.rejects(f.manager.run(load, uploadRequest(pdf())), /BUSY/);
  release({ reference: 'cloudinary:new-private-media' });
  await first;
  assert.equal(f.calls.filter(c => c.name === 'begin_staff_document_upload').length, 1);
});

test('RPC timeout releases busy state and retry keeps its operation identity', async () => {
  const calls = [];
  let begins = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'staff' } } } }) },
    rpc(name, params) {
      calls.push({ name, params });
      return { abortSignal: () => name === 'begin_staff_document_upload' && ++begins === 1
        ? new Promise(() => {}) : Promise.resolve({ data: name === 'begin_staff_document_upload'
          ? { versionId: 'version-new', documentId: 'doc-a' } : row }) };
    },
  };
  const manager = createStaffDocumentManager({ client, ownerId: 'staff', timeoutMs: 10, uuid: () => 'stable-operation',
    uploadMedia: async () => ({ reference: 'cloudinary:asset' }) });
  const request = uploadRequest(pdf());
  await assert.rejects(manager.run(load, request), /REQUEST_TIMEOUT/);
  await manager.run(load, request);
  assert.deepEqual(calls[0].params, calls[1].params);
  manager.dispose();
});

test('explicit multi-stop upload targets exactly its supplied stop', async () => {
  const f = fixture({ rpcResult: name => name === 'complete_staff_document_upload'
    ? { data: { ...row, document_type: 'pod', stop_id: 'delivery-2' } } : undefined });
  await f.manager.run(load, { ...uploadRequest(pdf()), type: 'pod', stopId: 'delivery-2' });
  assert.equal(f.calls[0].params.p_stop_id, 'delivery-2');
  assert.equal(f.calls[0].params.p_document_type, 'pod');
});

test('replayed ack cannot overwrite metadata for a newer version or different document', async () => {
  for (const changed of [{ current_version_id: 'newer' }, { id: 'other-doc' }, { document_type: 'pod' }, { load_id: 'other-load' }]) {
    const f = fixture({ rpcResult: name => name === 'complete_staff_document_upload' ? { data: { ...row, ...changed } } : undefined });
    await assert.rejects(f.manager.run(load, uploadRequest(pdf())), /CONFLICT|INVALID_RESULT/);
  }
  const f = fixture({ rpcResult: () => ({ data: row }) });
  await assert.rejects(f.manager.run(load, { type: 'ratecon', action: 'remove', documentId: 'doc-a', expectedVersionId: 'old' }), /CONFLICT/);
});

test('ack preserves another stop in an open viewer and keeps surviving documents visible', () => {
  const first = { id: 'pod-1', load_id: load.id, document_type: 'pod', current_version_id: 'v1' };
  const second = { ...first, id: 'pod-2', current_version_id: 'v2' };
  const original = { ...load, documentItems: [first, second], documentMeta: { receiverPod: second } };
  const updated = applyStaffDocumentResult(original, { ...first, current_version_id: 'v3' });
  assert.equal(refreshOpenDocumentLoad(original, updated).documentMeta.receiverPod.id, second.id);
  const removed = applyStaffDocumentResult(original, { ...second, current_version_id: null });
  assert.equal(removed.documentMeta.receiverPod.id, first.id);
  assert.equal(refreshOpenDocumentLoad(original, removed).documentMeta.receiverPod.current_version_id, null);
});

test('remove is scoped and versioned; never invokes Storage or Cloudinary deletion', async () => {
  const f = fixture({ rpcResult: () => ({ data: { ...row, current_version_id: null }, error: null }) });
  const result = await f.manager.run(load, { type: 'ratecon', action: 'remove', documentId: 'doc-a', expectedVersionId: 'version-old' });
  assert.equal(f.calls.length, 1); assert.equal(result.current_version_id, null);
  assert.deepEqual(f.calls[0], { name: 'remove_staff_load_document', params: { p_load_id: 'load-a', p_document_id: 'doc-a',
    p_expected_current_version_id: 'version-old', p_operation_id: 'op-1' } });
});

test('receipt, trashed load, stale version and unsupported actions cannot mutate', async () => {
  const f = fixture();
  for (const request of [{ type: 'receipt', action: 'upload' }, { type: 'pod', action: 'delete' },
    { type: 'pod', action: 'remove', expectedVersionId: null }]) await assert.rejects(f.manager.run(load, request), /CONFLICT/);
  await assert.rejects(f.manager.run({ ...load, trashedAt: 'now' }, uploadRequest(pdf())), /CONFLICT/);
  assert.equal(f.calls.length, 0);
  const g = fixture({ rpcResult: () => rejected('STAFF_DOCUMENT_CONFLICT') });
  await assert.rejects(g.manager.run(load, uploadRequest(pdf())), /CONFLICT/);
  assert.equal(g.calls.length, 1);
});

test('ack clears cached URL/review without changing route, prices or pay; viewer preserves exact stop', () => {
  const old = { ...load, documents: { rateCon: 'expired-url' }, documentMeta: { rateCon: { id: 'doc-a' } }, documentChecks: { rateCon: { status: 'passed' } } };
  const updated = applyStaffDocumentResult(old, row);
  assert.equal(updated.rate, old.rate); assert.deepEqual(updated.driverBrief, old.driverBrief);
  assert.equal(updated.documents.rateCon, null); assert.equal(updated.documentMeta.rateCon.current_version_id, 'version-new');
  assert.equal(updated.documentChecks.rateCon, null);
  assert.equal(applyStaffDocumentResult({ id: 'other' }, row).id, 'other');
  const selected = { id: 'load-a', documentMeta: { receiverPod: { id: 'pod-2' } } };
  const fresh = { id: 'load-a', documents: { receiverPod: 'first-stop-url' }, documentMeta: { receiverPod: { id: 'pod-1' } },
    documentItems: [{ id: 'pod-1', current_version_id: 'one' }, { id: 'pod-2', current_version_id: null }] };
  assert.equal(refreshOpenDocumentLoad(selected, fresh).documentMeta.receiverPod.id, 'pod-2');
  assert.equal(refreshOpenDocumentLoad(selected, fresh).documentMeta.receiverPod.current_version_id, null);
  assert.equal(refreshOpenDocumentLoad(selected, fresh).documents.receiverPod, null);
});

test('context fetch is load-scoped metadata-only and propagates access errors', async () => {
  const calls = [];
  const client = { from(table) { const query = { select(fields) { calls.push([table, fields]); return query; },
    eq(field, value) { calls.push([field, value]); return query; }, order() { return query; },
    abortSignal() { return { data: table === 'documents' ? [{ ...row, current_version: { file_name: 'new.pdf', mime_type: 'application/pdf' } }] : [] }; } }; return query; } };
  const result = await fetchStaffLoadDocumentContext(client, load.id);
  assert.equal(result.documentItems[0].fileName, 'new.pdf');
  assert.deepEqual(calls.filter(c => c[0] === 'load_id'), [['load_id', load.id], ['load_id', load.id]]);
  assert.equal(calls.some(c => c[1].includes('storage_path')), false);
  const denied = { from() { const query = { select() { return query; }, eq() { return query; }, order() { return query; },
    abortSignal() { return { data: null, error: new Error('permission denied') }; } }; return query; } };
  await assert.rejects(fetchStaffLoadDocumentContext(denied, load.id), /permission denied/);
});
