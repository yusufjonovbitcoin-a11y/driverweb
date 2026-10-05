import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

// SSR covers visible states and localization. Focus, typing and click behavior
// require a browser; workflow session/race checks live in separate tests.
const server = await createServer({
  configFile: false,
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const previousFetch = globalThis.fetch;
let networkAttempts = 0;

try {
  const { default: ImportDriverPicker } = await server.ssrLoadModule('/src/components/ImportDriverPicker.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  globalThis.fetch = () => {
    networkAttempts += 1;
    throw new Error('Driver picker SSR must not request the network');
  };

  const drivers = [
    { id: 'driver-a', name: 'Test Driver Alpha', driverNumber: '#A100', truck: 'Volvo 760' },
    { id: 'driver-b', name: 'Test Driver Beta', driverNumber: '#B200', truck: 'Truck 22' },
  ];
  const action = () => { throw new Error('SSR must not invoke an action'); };
  const props = {
    drivers,
    fileName: 'sample-load.pdf',
    processing: true,
    onSelectDriver: action,
    onCancel: action,
    onRetry: action,
  };
  const render = (overrides = {}) => renderToString(React.createElement(ImportDriverPicker, { ...props, ...overrides })).replace(/<!--.*?-->/g, '');
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const translated = (key, params) => escape(i18n.t(key, params));
  const driverButtons = html => [...html.matchAll(/<button\b[^>]*class="import-driver-option[^"]*"[^>]*>/g)].map(match => match[0]);
  const selectedButtons = html => driverButtons(html).filter(button => button.includes('aria-pressed="true"'));
  const noRawKeys = (html, locale) => {
    assert.ok(!html.includes('documentImportSelection.'), `${locale}: no raw picker translation keys`);
    assert.ok(!html.includes('undefined'), `${locale}: missing values never leak into UI`);
  };

  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const html = render();
    assert.match(html, /role="dialog"[^>]*aria-modal="true"/, `${locale}: accessible modal`);
    const titleId = html.match(/aria-labelledby="([^"]+)"/)[1];
    assert.ok(html.includes(`<h2 id="${titleId}">${translated('documentImportSelection.title')}</h2>`), `${locale}: dialog title is connected`);
    assert.match(html, /<input[^>]*type="search"/, `${locale}: searchable driver list`);
    assert.ok(html.includes(translated('documentImportSelection.searchPlaceholder')), `${locale}: search is localized`);
    assert.ok(html.includes(translated('documentImportSelection.processingTitle')), `${locale}: analysis in progress`);
    assert.ok(html.includes(translated('documentImportSelection.processingHint')), `${locale}: can select while analysis runs`);
    assert.ok(html.includes(translated('documentImportSelection.selectHint')), `${locale}: direct-preview hint`);
    assert.ok(html.includes('sample-load.pdf'));
    assert.ok(html.includes(translated('documentImportSelection.driverNumber', { number: '#A100' })));
    assert.ok(html.includes(translated('documentImportSelection.truck', { number: 'Volvo 760' })));
    assert.equal(driverButtons(html).length, drivers.length, `${locale}: each driver is an immediate selection button`);
    assert.ok(driverButtons(html).every(button => !button.includes('disabled')), `${locale}: drivers remain selectable during processing`);
    assert.equal(selectedButtons(html).length, 0, `${locale}: no default driver selection`);
    assert.ok(!html.includes('import-driver-continue'), `${locale}: no extra Continue action`);
    assert.ok(!html.includes('type="radio"'), `${locale}: no extra selection step`);
    noRawKeys(html, locale);

    const processingSelected = render({ selectedDriverId: 'driver-a' });
    assert.equal(selectedButtons(processingSelected).length, 1, `${locale}: selected driver retained`);
    assert.ok(processingSelected.includes(translated('documentImportSelection.selectedDriver', { name: drivers[0].name })));
    assert.ok(driverButtons(processingSelected).every(button => !button.includes('disabled')));

    const ready = render({ processing: false });
    assert.ok(ready.includes(translated('documentImportSelection.readyTitle')), `${locale}: ready state`);
    assert.ok(!ready.includes(translated('documentImportSelection.processingTitle')));
    assert.ok(driverButtons(ready).every(button => !button.includes('disabled')), `${locale}: ready drivers selectable`);
    noRawKeys(ready, locale);

    const stale = render({ processing: false, selectedDriverId: 'removed-driver' });
    assert.equal(selectedButtons(stale).length, 0, `${locale}: stale driver is not selected`);
    assert.ok(stale.includes(translated('documentImportSelection.selectHint')));

    const localizedFailure = i18n.t('errors.documentAnalysis');
    const failed = render({ processing: false, error: localizedFailure, selectedDriverId: 'driver-b' });
    assert.ok(failed.includes('role="alert"'), `${locale}: error is announced`);
    assert.ok(failed.includes(translated('documentImportSelection.errorTitle')));
    assert.ok(failed.includes(escape(localizedFailure)), `${locale}: localized failure detail`);
    assert.match(failed, /<button[^>]*class="import-driver-retry"[^>]*>/, `${locale}: retry provided`);
    assert.doesNotMatch(failed, /<button[^>]*class="import-driver-retry"[^>]*disabled/, `${locale}: retry available after failure`);
    assert.equal(selectedButtons(failed).length, 1, `${locale}: selection survives failure`);
    assert.ok(driverButtons(failed).every(button => !button.includes('disabled')), `${locale}: selection can be changed after failure`);
    noRawKeys(failed, locale);

    const providerFailure = render({ processing: false, error: new Error('Failed to fetch INTERNAL_PROVIDER_DETAIL') });
    assert.ok(providerFailure.includes(translated('errors.network')), `${locale}: Error objects are localized`);
    assert.ok(!providerFailure.includes('INTERNAL_PROVIDER_DETAIL'), `${locale}: provider details stay out of UI`);
    const retrying = render({ processing: true, error: localizedFailure });
    assert.match(retrying, /<button[^>]*class="import-driver-retry"[^>]*disabled=""/, `${locale}: retry cannot repeat while processing`);

    const empty = render({ drivers: [], processing: false });
    assert.equal(driverButtons(empty).length, 0);
    assert.ok(empty.includes(translated('documentImportSelection.noDrivers')), `${locale}: fleet-empty state`);
    assert.ok(empty.includes(translated('documentImportSelection.noDriversHint')));
    assert.ok(!empty.includes(translated('documentImportSelection.noMatches')), `${locale}: empty fleet distinct from empty search`);
    noRawKeys(empty, locale);

    const unnamed = render({ drivers: [{ id: 'nameless' }], fileName: '' });
    assert.ok(unnamed.includes(translated('documentImportSelection.unnamedDriver')));
    assert.ok(unnamed.includes(translated('documentImportSelection.document')));
    noRawKeys(unnamed, locale);

    const catalog = i18n.getResourceBundle(locale, 'translation').documentImportSelection;
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${locale}: ${key} is a translated string`);
      assert.ok(value.trim(), `${locale}: ${key} is not empty`);
    }
    assert.ok(catalog.noMatches && catalog.noMatchesHint && catalog.clearSearch, `${locale}: search-empty copy exists`);
  }
  assert.equal(networkAttempts, 0);
  console.log('ImportDriverPicker SSR passed: 3 locales; processing, ready, stale selection, error/retry, empty fleet, direct driver buttons and accessible labels; no network. Browser focus and search interaction are not covered by SSR.');
} finally {
  globalThis.fetch = previousFetch;
  await server.close();
}
