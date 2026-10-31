import test from 'node:test';
import assert from 'node:assert/strict';
import { driverDocumentRegistry, driverLoadDocuments } from './driverDocumentRegistryModel.js';
import { documentViewerLoad } from './loadDocumentsModel.js';

const document = (id, type, stop, version = `v-${id}`) => ({ id, load_id: 'one', document_type: type, stop_id: stop, current_version_id: version, fileName: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 245000, uploadedAt: '2026-10-02T12:12:00Z' });
const load = () => ({ id: 'one', driverId: 'alpha', loadNumber: '#2536705', databaseStatus: 'completed', status: 'COMPLETED', origin: { city: 'Hilton', state: 'NY' }, destination: { city: 'Wind Gap', state: 'PA', appointmentAt: '2026-10-03T01:01:00Z', timezone: 'America/New_York' },
  documentItems: [document('rate', 'rate_confirmation', null), document('bol', 'bol', 'p1'), document('pod1', 'pod', 'd1'), document('pod2', 'pod', 'd2'), document('removed', 'pod', 'd1', null)] });

test('registry stays scoped to one driver and completed non-trashed loads', () => {
  const source = load();
  const rows = [source, ...[{ driverId: 'beta' }, { databaseStatus: 'cancelled' }, { databaseStatus: 'dispute' }, { databaseStatus: 'in_progress' }, { trashedAt: '2026-10-20' }].map((patch, index) => ({ ...source, id: `excluded-${index}`, ...patch }))];
  const groups = driverDocumentRegistry(rows, 'alpha');
  assert.equal(groups.length, 1); assert.equal(groups[0].documents.length, 4);
  assert.equal(groups[0].day, '2026-10-02');
  assert.equal(driverDocumentRegistry(rows, 'unknown').length, 0);
  assert.equal(driverDocumentRegistry(rows, 'alpha', { from: '2026-10-03' }).length, 0);
  assert.equal(driverDocumentRegistry(rows, 'alpha', { from: '2026-10-02', to: '2026-10-02' }).length, 1);
});

test('every stop file retains its exact version, metadata and viewer target', () => {
  const source = load(), docs = driverLoadDocuments(source);
  assert.deepEqual(docs.map(doc => doc.documentId), ['rate', 'bol', 'pod1', 'pod2']);
  assert.deepEqual(docs.map(doc => doc.sizeBytes), [245000, 245000, 245000, 245000]);
  const viewer = documentViewerLoad(source, docs[3]);
  assert.equal(viewer.documentMeta.receiverPod.id, 'pod2');
  assert.equal(viewer.documentMeta.receiverPod.stop_id, 'd2');
  assert.equal(viewer.documentMeta.receiverPod.current_version_id, 'v-pod2');
  assert.equal(driverLoadDocuments({ ...source, documentItems: [], documents: { receiverPod: 'stale.pdf' } }).length, 0);
  assert.equal(driverLoadDocuments({ ...source, documentItems: [document('foreign', 'bol', 'p1')].map(doc => ({ ...doc, load_id: 'other' })) }).length, 0);
});

test('search finds matching load rows by file or type without splitting their document bundle', () => {
  const source = load();
  assert.deepEqual(driverDocumentRegistry([source], 'alpha', { query: 'pod2' })[0].documents.map(doc => doc.documentId), ['rate', 'bol', 'pod1', 'pod2']);
  assert.equal(driverDocumentRegistry([source], 'alpha', { query: 'накладная', labels: { shipperBol: 'Транспортная накладная' } })[0].documents.length, 4);
  assert.equal(driverDocumentRegistry([source], 'alpha', { query: 'hilton' })[0].documents.length, 4);
  assert.equal(driverDocumentRegistry([source], 'alpha', { query: 'unmatched' }).length, 0);
});

test('legacy files remain usable and missing metadata stays unknown', () => {
  const source = { ...load(), documentItems: undefined, documents: { rateCon: '/file.pdf' }, documentMeta: { rateCon: { fileName: 'old.pdf' } } };
  const docs = driverLoadDocuments(source);
  assert.equal(docs.length, 1); assert.equal(docs[0].url, '/file.pdf');
  assert.equal(docs[0].sizeBytes, null); assert.equal(docs[0].uploadedAt, null);
  assert.equal(driverDocumentRegistry([{ ...source, destination: {} }], 'alpha', { to: '2026-10-10' }).length, 0);
});
