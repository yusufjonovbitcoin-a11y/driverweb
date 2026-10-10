import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { documentChoices } from '../src/components/loadDocumentsModel.js';

const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
const previousFetch = globalThis.fetch;
try {
  const { DocumentCardView: Card, DocumentRemovalDialog: Confirmation, DocumentSlot: Slot,
    default: Manager } = await server.ssrLoadModule('/src/components/LoadDocumentsManager.jsx');
  const { default: Modal } = await server.ssrLoadModule('/src/components/LoadDetailsModal.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  globalThis.fetch = () => { throw new Error('Rendering must not read or mutate live documents'); };
  const render = (Component, props) => renderToString(React.createElement(Component, props)).replace(/<!--.*?-->/g, '');
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const state = { busy: false, progress: null, error: null, action: null };
  const noop = () => { throw new Error('SSR must not invoke a document action'); };
  const load = { id: 'load-a', loadNumber: '#DOCUMENTS', databaseStatus: 'assigned', origin: {}, destination: {}, documents: {}, documentMeta: {} };
  const longName = '2026-10-08_Broker_Rate_Confirmation_and_all_operational_notes_for_the_same_load_without_truncating_the_original_filename.pdf';
  for (const locale of ['en', 'ru', 'uz']) {
    await i18n.changeLanguage(locale);
    const document = { id: 'rateCon', title: i18n.t('documents.brokerRateCon'), available: true,
      versionId: 'version-a', documentId: 'document-a', fileName: longName, mimeType: 'application/pdf' };
    const props = { document, state, editable: true, onOpen: noop, onChooseFile: noop, onRemove: noop };
    const ready = render(Card, props);
    for (const key of ['view', 'replace']) assert.ok(ready.includes(escape(i18n.t(`documentManagement.${key}`))), `${locale}: ${key}`);
    assert.ok(ready.includes(escape(i18n.t('documentManagement.removeDocument', { document: document.title }))));
    assert.ok(ready.includes(longName), `${locale}: full filename`);
    assert.ok(ready.includes('draggable="true"'), `${locale}: existing drag preserved`);
    assert.ok(ready.includes('load-document-format">PDF'));
    const missing = render(Card, { ...props, document: { ...document, available: false, versionId: null, fileName: null } });
    assert.ok(missing.includes(escape(i18n.t('documentManagement.add'))));
    assert.ok(!missing.includes('class="load-document-remove"'));
    assert.ok(!missing.includes('class="load-document-view"'));
    const readonly = render(Card, { ...props, editable: false });
    assert.ok(!readonly.includes('class="load-document-replace"') && !readonly.includes('class="load-document-remove"'));
    const legacy = render(Card, { ...props, document: { ...document, id: 'shipperBol' }, replaceAllowed: false });
    assert.match(legacy, /<button[^>]*class="load-document-replace"[^>]*disabled=""/);
    assert.ok(!/<button[^>]*class="load-document-remove"[^>]*disabled=""/.test(legacy));
    assert.ok(legacy.includes(escape(i18n.t('documentManagement.legacyReplaceHint'))));
    const receipt = render(Card, { ...props, document: { ...document, id: 'receipt', title: i18n.t('documents.paymentReceipt') } });
    assert.ok(receipt.includes(escape(i18n.t('documentManagement.viewOnly'))));
    assert.ok(!receipt.includes('class="load-document-replace"') && !receipt.includes('class="load-document-remove"'), 'receipt cannot be managed even if editable is passed');
    const busy = render(Card, { ...props, state: { ...state, busy: true, action: 'upload', progress: 42 } });
    assert.ok(busy.includes('value="42"')); assert.ok(busy.includes('42%'));
    assert.ok(busy.includes('aria-busy="true"') && busy.includes('inert=""'));
    const pendingProgress = render(Card, { ...props, state: { ...state, busy: true, action: 'upload' } });
    assert.match(pendingProgress, /<progress max="100" aria-label=/, 'unknown progress is indeterminate, not fake percent');
    const failed = render(Card, { ...props, state: { ...state, error: 'timeoutError', action: 'upload' }, onRetry: noop });
    assert.ok(failed.includes('role="alert"') && failed.includes(escape(i18n.t('documentManagement.retry'))));
    const dialog = render(Confirmation, { document, state, open: true, onCancel: noop, onConfirm: noop });
    assert.ok(dialog.includes('<dialog open=""'));
    assert.ok(dialog.includes(escape(i18n.t('documentManagement.removeHint'))));
    assert.ok(dialog.includes('aria-describedby=') && dialog.includes(longName));

    const bol = { ...document, id: 'shipperBol', title: i18n.t('documents.shipperBol'), versionId: 'v-second' };
    const choices = documentChoices(bol, { stops: [{ id: 'stop-a', type: 'pickup', sequence: 1, city: 'Phoenix', region: 'AZ' },
      { id: 'stop-b', type: 'pickup', sequence: 2, city: 'Tucson', region: 'AZ' }], documentItems: [
      { id: 'first', document_type: 'bol', stop_id: 'stop-a', current_version_id: 'v-first', fileName: 'first.pdf' },
      { id: 'second', document_type: 'bol', stop_id: 'stop-a', current_version_id: 'v-second', fileName: 'second.pdf' },
    ] });
    const multiple = render(Slot, { load, base: bol, choices, onOpenDocs: noop, onManageDocument: noop });
    assert.ok(multiple.includes('<select'));
    assert.ok(multiple.includes('value="document:second" selected=""'), 'current selected version determines exact document');
    assert.ok(multiple.includes('value="add:stop-b"'), 'second pickup can receive a new file');
    assert.ok(multiple.includes('second.pdf'));
    const hydrating = render(Manager, { load, documents: [document, bol], onOpenDocs: noop, onManageDocument: noop });
    assert.ok(hydrating.includes('aria-busy="true"') && hydrating.includes('load-document-skeleton'));
    assert.ok(!hydrating.includes(longName), 'staff never falls back to unverified first-of-type context while loading');
    const modal = render(Modal, { load: { ...load, documentMeta: { rateCon: { current_version_id: 'version-a', fileName: longName } } }, onClose: noop, onOpenDocs: noop });
    assert.ok(modal.includes('load-document-section-header') && modal.includes('load-document-grid'));
    assert.ok(modal.includes(escape(i18n.t('documents.combinePdf'))), 'combined PDF action remains in the section header');
    assert.ok(!modal.includes('documentManagement.'), 'no untranslated document UI keys');
  }
  const css = await readFile(new URL('../src/components/loadDetails.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.load-document-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(css.includes('@media (max-width:480px)'));
  assert.ok(css.includes('.load-document-preview .truncate { white-space:normal; overflow:visible; text-overflow:clip;'));
  assert.ok(css.includes('.dark .load-document-error'));
  console.log('Document management render: three locales, 2-column responsive cards, full filenames, receipt read-only, real/indeterminate progress, removal confirmation, exact multi-stop/file selection and fail-closed hydration passed.');
} finally { globalThis.fetch = previousFetch; await server.close(); }
