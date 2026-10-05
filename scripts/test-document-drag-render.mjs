import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { default: Card } = await server.ssrLoadModule('/src/components/DraggableLoadDocument.jsx');
  const { default: Modal } = await server.ssrLoadModule('/src/components/LoadDetailsModal.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    for (const id of ['rateCon', 'shipperBol', 'receiverPod', 'receipt']) {
      const html = renderToString(React.createElement(Card, { document: { id, title: id, available: true, versionId: 'version' }, onOpen() {} }));
      assert.ok(html.includes('draggable="true"'));
      assert.ok(html.includes(i18n.t('documents.uploaded')));
      assert.ok(!html.includes('disabled=""'));
    }
    const absent = renderToString(React.createElement(Card, { document: { title: 'Missing', available: false }, onOpen() {} }));
    assert.ok(absent.includes('draggable="false"'));
    assert.ok(absent.includes('disabled=""'));
    const html = renderToString(React.createElement(Modal, { load: { id: 'load', status: 'ASSIGNED', documents: {}, documentMeta: { rateCon: { current_version_id: 'version' } } }, onClose() {}, onOpenDocs() {} }));
    assert.equal((html.match(/draggable="true"/g) || []).length, 1, 'only existing individual file is draggable before merge');
    assert.ok(!html.includes(i18n.t('documents.combiningPdf')), 'combined PDF does not load on mount');
  }
  const source = await readFile(new URL('../src/components/LoadDetailsModal.jsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('onPointerEnter={preparePdfForDrag}'));
  assert.ok(!source.includes('onFocus={preparePdfForDrag}'));
  console.log('Document cards: four types, three locales, absent files, durable IDs, no automatic merge preparation passed.');
} finally { await server.close(); }
