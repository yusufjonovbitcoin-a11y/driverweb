import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

// Local render and destructive-confirmation guards only. No database or network.
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
  const { default: LoadTrashPanel, activeTrashDrivers, filterTrashedLoads, matchesDeleteConfirmation, isReviewedTrashLoadCurrent } = await server.ssrLoadModule('/src/components/LoadTrashPanel.jsx');
  const { default: LoadsWorkspace } = await server.ssrLoadModule('/src/components/LoadsWorkspace.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  globalThis.fetch = () => {
    networkAttempts += 1;
    throw new Error('Trash render must not request the network');
  };
  const drivers = [
    { id: 'active-a', name: 'Test Driver Alpha', driverNumber: 'D-100', accountStatus: 'active' },
    { id: 'active-b', name: 'Test Driver Beta', driverNumber: 'D-200', status: 'AVAILABLE' },
    { id: 'suspended-a', name: 'Suspended Driver A', accountStatus: 'suspended' },
    { id: 'suspended-b', name: 'Suspended Driver B', status: 'SUSPENDED' },
  ];
  const loads = [{
    id: 'trash-a', loadNumber: 'TRASH-042', trashedDriverId: 'active-a', trashedAt: '2026-10-06T09:00:00.000Z',
    origin: { city: 'New York', state: 'NY' }, destination: { city: 'Boston', state: 'MA' },
  }, {
    id: 'trash-b', loadNumber: 'TRASH-043', origin: { city: 'Dallas', state: 'TX' }, destination: { city: 'Denver', state: 'CO' },
  }];
  const driversById = new Map(drivers.map(driver => [driver.id, driver]));
  const action = () => { throw new Error('SSR must not invoke load actions'); };
  const props = { loads, drivers, onOpenDocs: action, onRestoreLoad: action, onPermanentlyDeleteLoad: action };
  const render = overrides => renderToString(React.createElement(LoadTrashPanel, { ...props, ...overrides })).replace(/<!--.*?-->/g, '');
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const translated = (key, params) => escape(i18n.t(key, params));

  assert.deepEqual(activeTrashDrivers([...drivers, null, {}]).map(driver => driver.id), ['active-a', 'active-b']);
  assert.deepEqual(filterTrashedLoads(loads, 'new york alpha 042', driversById).map(load => load.id), ['trash-a']);
  assert.deepEqual(filterTrashedLoads(loads, 'd100', driversById).map(load => load.id), ['trash-a']);
  assert.deepEqual(filterTrashedLoads(loads, 'denver tx', driversById).map(load => load.id), ['trash-b']);
  assert.equal(filterTrashedLoads(loads, 'missing', driversById).length, 0);
  assert.ok(matchesDeleteConfirmation(loads[0], 'TRASH-042'));
  for (const input of ['', '042', 'trash-042', ' TRASH-042', 'TRASH-042 ']) assert.equal(matchesDeleteConfirmation(loads[0], input), false);
  assert.equal(matchesDeleteConfirmation({ loadNumber: '' }, ''), false);
  assert.equal(matchesDeleteConfirmation({}, ''), false);
  const reviewed = { ...loads[0], version: 1 };
  assert.ok(isReviewedTrashLoadCurrent(reviewed, { ...reviewed }));
  assert.equal(isReviewedTrashLoadCurrent(reviewed, { ...reviewed, version: 2 }), false, 'Realtime version change invalidates reviewed deletion');
  assert.equal(isReviewedTrashLoadCurrent(reviewed, { ...reviewed, trashedAt: null }), false, 'Restored load cannot remain a reviewed trash target');
  assert.equal(isReviewedTrashLoadCurrent(reviewed, { ...reviewed, loadNumber: 'REPLACED' }), false, 'Confirmation remains bound to reviewed load number');
  assert.equal(isReviewedTrashLoadCurrent(null, reviewed), false);

  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const html = render();
    for (const key of ['title', 'subtitle', 'searchPlaceholder', 'restoreHint', 'documents', 'chooseDriver', 'restoreWithDriver', 'permanentlyDelete', 'previousDriver', 'deletedAt']) {
      assert.ok(i18n.exists(`loadTrash.${key}`, { lng: locale }), `${locale}: ${key} exists`);
      assert.ok(html.includes(translated(`loadTrash.${key}`)), `${locale}: ${key} renders`);
    }
    assert.match(html, /<input[^>]*type="search"/, `${locale}: searchable trash`);
    assert.ok(html.includes('TRASH-042') && html.includes('TRASH-043'));
    assert.ok(html.includes('Test Driver Alpha') && html.includes('New York') && html.includes('Boston'));
    assert.ok(html.includes(translated('loadTrash.unassigned')));
    assert.ok(!html.includes('Suspended Driver'), `${locale}: suspended drivers cannot receive restored loads`);
    assert.ok(!html.includes('class="load-trash-restore"'), `${locale}: no no-driver restore action`);
    assert.match(html, /<button[^>]*class="load-trash-assign-button"[^>]*disabled=""/, `${locale}: requires explicit driver selection`);
    assert.ok(!html.includes('loadTrash.'), `${locale}: no raw keys`);
    assert.ok(!html.includes('load-trash-confirmation'), `${locale}: destructive confirmation closed initially`);

    const empty = render({ loads: [] });
    assert.ok(empty.includes(translated('loadTrash.emptyTitle')) && empty.includes(translated('loadTrash.emptyHint')));
    const noDrivers = render({ drivers: [] });
    assert.ok(noDrivers.includes(translated('loadTrash.noActiveDrivers')));
    assert.ok(noDrivers.includes(translated('loadTrash.unknownDriver')), `${locale}: absent prior driver is distinguished from unassigned`);
    assert.match(noDrivers, /<select[^>]*disabled=""/);
    const missing = render({ loads: [{ id: 'missing' }] });
    assert.ok(!missing.includes('undefined') && !missing.includes('NaN'));
    assert.match(missing, /<button[^>]*class="load-trash-delete"[^>]*disabled=""/, `${locale}: missing number cannot satisfy destructive confirmation`);

    const workspace = renderToString(React.createElement(LoadsWorkspace, { loads: [], drivers, trashedLoads: loads }));
    assert.match(workspace, /class="fleet-loads-trash-toggle"[^>]*aria-pressed="false"/);
    assert.ok(workspace.includes(translated('loadTrash.countLabel', { count: 2 })));
    assert.ok(!workspace.includes('TRASH-042'), `${locale}: trashed loads are not board cards`);
  }
  const readOnly = render({ onRestoreLoad: undefined, onPermanentlyDeleteLoad: undefined, onOpenDocs: undefined });
  for (const className of ['load-trash-restore', 'load-trash-assign-button', 'load-trash-delete', 'load-trash-documents']) {
    assert.ok(!readOnly.includes(`class="${className}"`), `No unsupported ${className} action`);
  }
  assert.equal(networkAttempts, 0);
  console.log('Load trash SSR passed: 3 locales, previous driver and route search, active drivers, exact delete confirmation, empty/missing/read-only states, documents and workspace count; no network. Click/promise/focus behavior requires browser verification.');
} finally {
  globalThis.fetch = previousFetch;
  await server.close();
}
