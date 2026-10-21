import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  setLoadDocumentsPdfDragData,
  mergeLoadDocumentsPdf,
  documentSectionHeader,
  orderedLoadDocuments,
} from './loadDocumentPdf.js';

test('drag payload exposes the merged PDF as both a file and download URL', () => {
  const values = new Map();
  const files = [];
  const dataTransfer = {
    effectAllowed: 'none',
    items: { add: (file) => files.push(file) },
    setData: (type, value) => values.set(type, value),
  };
  const file = { name: '38495207-documents.pdf' };

  setLoadDocumentsPdfDragData(dataTransfer, file, 'data:application/pdf;base64,JVBERi0=');

  assert.equal(dataTransfer.effectAllowed, 'copy');
  assert.deepEqual(files, [file]);
  assert.equal(values.get('DownloadURL'), 'application/pdf:38495207-documents.pdf:data:application/pdf;base64,JVBERi0=');
  assert.equal(values.get('text/uri-list'), 'data:application/pdf;base64,JVBERi0=');
});

test('native DownloadURL remains available when a browser rejects the synthetic File item', () => {
  const values = new Map();
  const dataTransfer = {
    effectAllowed: 'none',
    items: { add: () => { throw new DOMException('Not supported'); } },
    setData: (type, value) => values.set(type, value),
  };

  setLoadDocumentsPdfDragData(
    dataTransfer,
    { name: 'load-documents.pdf' },
    'data:application/pdf;base64,JVBERi0=',
  );

  assert.equal(values.has('DownloadURL'), true);
  assert.equal(values.has('text/uri-list'), true);
});

async function pdfResponse(pageWidths) {
  const document = await PDFDocument.create();
  pageWidths.forEach((width) => {
    const page = document.addPage([width, 500]);
    page.drawRectangle({ x: 1, y: 1, width: 1, height: 1 });
  });
  const bytes = await document.save();
  return new Response(bytes, { headers: { 'content-type': 'application/pdf' } });
}

function pngResponse() {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  return new Response(bytes, { headers: { 'content-type': 'image/png' } });
}

test('documents are always ordered Rate Con, BOL, POD, then receipt', () => {
  const documents = orderedLoadDocuments({
    documents: {
      receipt: '/receipt.pdf',
      receiverPod: '/pod.pdf',
      rateCon: '/rate.pdf',
      shipperBol: null,
    },
  });

  assert.deepEqual(documents.map((document) => document.id), [
    'rateCon',
    'receiverPod',
    'receipt',
  ]);
});

test('combining includes every active file at every stop, never removed representatives', () => {
  const doc = (id, type, stop, version = `v-${id}`) => ({ id, document_type: type, stop_id: stop, current_version_id: version });
  const load = { documents: { shipperBol: 'stale-removed.pdf' }, stops: [{ id: 'p1', sequence: 1 }, { id: 'p2', sequence: 2 }, { id: 'd1', sequence: 3 }, { id: 'd2', sequence: 4 }],
    documentItems: [doc('d2', 'pod', 'd2'), doc('b', 'bol', 'p2'), doc('a2', 'bol', 'p1'), doc('a1', 'bol', 'p1'),
      doc('removed', 'bol', 'p1', null), doc('rate', 'rate_confirmation', null), doc('d1', 'pod', 'd1'), doc('receipt', 'receipt', null)] };
  const result = orderedLoadDocuments(load);
  assert.deepEqual(result.map(item => item.documentId), ['rate', 'a1', 'a2', 'b', 'd1', 'd2', 'receipt']);
  assert.deepEqual(result.filter(item => item.id === 'shipperBol').map(item => item.label), ['BOL - Stop 1', 'BOL - Stop 1', 'BOL - Stop 2']);
  assert.deepEqual(orderedLoadDocuments({ ...load, documentItems: [] }), []);
});

test('each section header identifies its document and page position', () => {
  assert.equal(documentSectionHeader('BOL', 0, 3), 'BOL  ·  1/3');
  assert.equal(
    documentSectionHeader('Payment Receipt', 0, 1),
    'PAYMENT RECEIPT  ·  1/1',
  );
});

test('merge re-signs every version and includes documents without snapshot URLs', async () => {
  const resolved = [];
  const fetched = [];
  const result = await mergeLoadDocumentsPdf({
    documents: { rateCon: 'https://example.test/expired' },
    documentMeta: {
      rateCon: { current_version_id: 'rate' },
      shipperBol: { current_version_id: 'bol' },
      receiverPod: { current_version_id: 'pod' },
      receipt: { current_version_id: 'receipt' },
    },
  }, {
    resolveSource: async document => { resolved.push(document.versionId); return { mediaUrl: `https://example.test/fresh-${document.versionId}`, mimeType: 'application/pdf' }; },
    fetchDocument: async url => { fetched.push(url); return pdfResponse([200]); },
  });
  assert.deepEqual(resolved, ['rate', 'bol', 'pod', 'receipt']);
  assert.ok(fetched.every(url => url.includes('/fresh-')));
  assert.equal(result.documentCount, 4);
  assert.equal(result.pageCount, 4);
});

test('merge fails closed when one document loses access, never downloads cached URL', async () => {
  await assert.rejects(mergeLoadDocumentsPdf({ documents: { rateCon: 'https://example.test/expired' }, documentMeta: { rateCon: { current_version_id: 'rate' } } }, {
    resolveSource: async () => { throw Error('denied'); },
    fetchDocument: async () => assert.fail('must not use old URL'),
  }), /denied/);
});

test('merged PDF preserves document order, internal pages, and receipt image', async () => {
  const sources = new Map([
    ['/rate.pdf', await pdfResponse([101, 102])],
    ['/bol.pdf', await pdfResponse([201])],
    ['/pod.pdf', await pdfResponse([301, 302])],
    ['/receipt.png', pngResponse()],
  ]);
  const load = {
    documents: {
      receipt: '/receipt.png',
      receiverPod: '/pod.pdf',
      shipperBol: '/bol.pdf',
      rateCon: '/rate.pdf',
    },
    documentMeta: {
      rateCon: { mimeType: 'application/pdf' },
      shipperBol: { mimeType: 'application/pdf' },
      receiverPod: { mimeType: 'application/pdf' },
      receipt: { mimeType: 'image/png' },
    },
  };

  const result = await mergeLoadDocumentsPdf(load, {
    fetchDocument: async (url) => sources.get(url).clone(),
  });
  const merged = await PDFDocument.load(result.bytes);

  assert.equal(result.documentCount, 4);
  assert.equal(result.pageCount, 6);
  assert.deepEqual(
    merged.getPages().map((page) => page.getWidth()),
    [101, 102, 201, 301, 302, 612],
  );
});
