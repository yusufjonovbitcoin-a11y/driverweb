import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
const previousFetch = globalThis.fetch;
try {
  const { AssignmentDriverPayView: View } = await server.ssrLoadModule('/src/components/AssignmentDriverPay.jsx');
  const { default: Modal } = await server.ssrLoadModule('/src/components/LoadDetailsModal.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  const { formatCurrency, formatNumber } = await server.ssrLoadModule('/src/i18n/format.js');
  globalThis.fetch = () => { throw new Error('Render must not make authenticated or external requests'); };
  const pay = { status: 'awaiting_start', ratePerMile: 0.7855, loadedMiles: null, deadheadMiles: null, totalMiles: null, amount: null, canRetry: false };
  const state = { pay, loaded: true, busy: false, error: null };
  const render = (nextState = state) => renderToString(React.createElement(View, { state: nextState })).replace(/<!--.*?-->/g, '');
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const html = render();
    for (const key of ['pending', 'pendingHint', 'loadedMiles', 'deadheadMiles', 'frozenRate', 'totalPay']) {
      assert.ok(i18n.exists(`driverPay.${key}`, { lng: locale }));
      assert.ok(html.includes(escape(i18n.t(`driverPay.${key}`))), `${locale}: ${key}`);
    }
    assert.ok(!html.includes('<form') && !html.includes('<input') && !html.includes('<textarea'), `${locale}: pending is read-only`);
    assert.ok(!html.includes(formatCurrency(0)), `${locale}: unknown money is not zero`);
    assert.ok(html.includes(escape(formatNumber(0.7855, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }))));
    assert.ok(!html.includes('driverPay.'));
    assert.ok(html.includes('START'), `${locale}: automatic calculation uses START origin`);
    const ready = render({ ...state, pay: { ...pay, status: 'ready', loadedMiles: 100, deadheadMiles: 20, totalMiles: 120, amount: 94.26 } });
    assert.ok(ready.includes(escape(i18n.t('driverPay.calculated')))); assert.ok(ready.includes(escape(formatCurrency(94.26))));
    assert.ok(!ready.includes('<form') && !ready.includes('<button'));
    const failed = render({ ...state, error: 'load', busy: true });
    assert.ok(failed.includes('role="alert"')); assert.ok(failed.includes('disabled=""'));
    for (const [status, label, hint] of [['calculating', 'calculating', 'calculatingHint'],
      ['retry_wait', 'retryWait', 'retryWaitHint'], ['failed', 'failed', 'failedHint']]) {
      const lifecycle = render({ ...state, pay: { ...pay, status, canRetry: status === 'failed' } });
      assert.ok(lifecycle.includes(escape(i18n.t(`driverPay.${label}`))));
      assert.ok(lifecycle.includes(escape(i18n.t(`driverPay.${hint}`))));
      assert.ok(!lifecycle.includes(formatCurrency(0)), `${locale}: ${status} does not invent money`);
      assert.equal(lifecycle.includes(`>${escape(i18n.t('driverPay.retryCalculation'))}</button>`), status === 'failed');
    }
    const terminal = render({ ...state, pay: { ...pay, status: 'failed', errorCode: 'DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE', canRetry: false } });
    assert.ok(terminal.includes(escape(i18n.t('driverPay.routeReviewHint'))));
    assert.ok(!terminal.includes(`>${escape(i18n.t('driverPay.retryCalculation'))}</button>`));
    const retryError = render({ ...state, error: 'retry' });
    assert.ok(retryError.includes(escape(i18n.t('driverPay.retryError'))));
    const load = { id: 'load-a', loadNumber: 'RATE-TEST', driverId: 'driver-a', currentAssignmentId: 'assignment-a', rate: 4200, distanceMiles: 800, ratePerMile: 5.25, documents: {} };
    const modal = renderToString(React.createElement(Modal, { load, onClose() {}, onOpenDocs() {}, onTrashLoad() {} })).replace(/<!--.*?-->/g, '');
    assert.ok(modal.includes(escape(formatCurrency(4200))), `${locale}: staff broker rate stays intact`);
  }
  assert.equal(render({ ...state, pay: null }), '');
  console.log('Driver pay render passed: three locales, atomic lifecycle statuses, scoped retry action, unknown amounts, frozen 4-decimal rate, terminal/error states, unchanged broker rate.');
} finally { globalThis.fetch = previousFetch; await server.close(); }
