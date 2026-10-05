import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

// Offline component render: effects/signing are tested separately, no API calls.
const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { default: Modal } = await server.ssrLoadModule('/src/components/DocumentViewerModal.jsx');
  const { default: Frame } = await server.ssrLoadModule('/src/components/DocumentViewerFrame.jsx');
  const { default: QuickDriverModal } = await server.ssrLoadModule('/src/components/QuickDriverModal.jsx');
  const { default: DocumentsView } = await server.ssrLoadModule('/src/components/DocumentsView.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  for (const locale of ['ru', 'uz', 'en']) {
    await i18n.changeLanguage(locale);
    for (const tab of ['rateCon', 'shipperBol', 'receiverPod', 'receipt']) {
      const load = { id: 'load', loadNumber: '#TEST', origin: {}, destination: {}, rate: 1,
        documents: { [tab]: 'https://example.test/expired.pdf?token=old' },
        documentMeta: { [tab]: { current_version_id: 'version', mimeType: 'application/pdf' } } };
      const html = renderToString(React.createElement(Modal, { isOpen: true, load, initialDocumentTab: tab }));
      assert.ok(html.includes('role="status"'), `${locale}/${tab}: wait for fresh signing`);
      assert.ok(!html.includes('token=old'), `${locale}/${tab}: never expose snapshot URL`);
      load.documents = {};
      assert.ok(renderToString(React.createElement(Modal, { isOpen: true, load, initialDocumentTab: tab })).includes('role="status"'),
        `${locale}/${tab}: version ID recovers missing initial signed URL`);
    }
  }
  const props = { url: 'https://example.test/expired.pdf', pageCount: 1, pageNumber: 1, zoom: 1 };
  const freshFrame = renderToString(React.createElement(Frame, { ...props, onOpenOriginal() {} }));
  assert.ok(!freshFrame.includes('href='), 'Original action resolves URL, never stale href');
  const downloadFrame = renderToString(React.createElement(Frame, { ...props, onOpenOriginal() {}, onDownload() {}, downloading: true, actionError: 'download-error' }));
  assert.ok(downloadFrame.includes('Downloading'), 'Download progress is visible');
  assert.ok(downloadFrame.includes('disabled=""'), 'Download is disabled while pending');
  assert.ok(downloadFrame.includes('role="alert"'), 'Download failures are announced');
  const legacyFrame = renderToString(React.createElement(Frame, props));
  assert.ok(legacyFrame.includes('href="https://example.test/expired.pdf"'), 'Other preview callers retain direct URL support');
  const quick = renderToString(React.createElement(QuickDriverModal, {
    isOpen: true, drivers: [], onOpenDocs() {},
    loadData: { id: 'saved', rate: 1, origin: {}, destination: {}, driverBrief: { fields: [] },
      documentMeta: { rateCon: { current_version_id: 'durable-version' } } },
  }));
  assert.ok(quick.includes(i18n.t('driverBrief.original')), 'Saved load assignment keeps Original with only a durable ID');
  assert.ok(!quick.includes('href='), 'Saved original opens through fresh version authorization');
  const documents = renderToString(React.createElement(DocumentsView, { drivers: [], loads: [
    { id: 'saved', rate: 1, origin: {}, destination: {},
      documentMeta: { rateCon: { current_version_id: 'durable-version' } } },
  ] }));
  assert.ok(documents.includes(`title="${i18n.t('documents.uploaded')}"`), 'Document list recognizes durable ID without URL');
  console.log('Document viewer: four tabs, three locales, missing/stale URLs, fresh original action passed.');
} finally {
  await server.close();
}
