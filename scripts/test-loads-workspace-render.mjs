import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

// SSR smoke coverage only: no browser, authentication, listener or network calls.
// Interaction logic is covered separately by loadWorkspaceModel.test.js.
const server = await createServer({
  configFile: false,
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const previousFetch = globalThis.fetch;
let networkAttempts = 0;

try {
  const { default: LoadsWorkspace } = await server.ssrLoadModule('/src/components/LoadsWorkspace.jsx');
  const { default: KanbanBoard } = await server.ssrLoadModule('/src/components/KanbanBoard.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  // A previously selected table mode must not override the redesigned board.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'table', setItem: () => { throw new Error('SSR must not write storage'); } },
  });
  globalThis.fetch = () => {
    networkAttempts += 1;
    throw new Error('Loads workspace SSR must not request the network');
  };

  const drivers = [
    { id: 'driver-a', name: 'Test Driver Alpha', driverNumber: '#A100', truck: 'Volvo 760' },
    { id: 'driver-b', name: 'Test Driver Beta', driverNumber: '#B200', trailer: 'Reefer 53' },
  ];
  const load = (id, status, driverId, extra = {}) => ({
    id, loadNumber: `TEST-${id}`, status, driverId,
    broker: 'Test Broker', rate: 1050, equipment: 'Dry Van',
    origin: { city: 'Test Pickup', state: 'MA', date: '2026-10-01' },
    destination: { city: 'Test Delivery', state: 'PA' },
    ...extra,
  });
  const loads = [
    load('UNASSIGNED', 'UNASSIGNED', null, { databaseStatus: 'ready_for_offer', targetDriverIds: ['driver-a', 'driver-b'] }),
    load('ASSIGNED', 'ASSIGNED', 'driver-a', { databaseStatus: 'assigned', currentAssignmentId: 'assignment-a' }),
    load('PICKED-UP', 'PICKED_UP', 'driver-b', { databaseStatus: 'in_progress', currentAssignmentId: 'assignment-b' }),
    load('ON-ROAD', 'ON_ROAD', 'driver-a', { databaseStatus: 'in_progress' }),
    load('DELIVERED', 'DELIVERED', 'driver-b', { databaseStatus: 'delivered' }),
    load('COMPLETED', 'COMPLETED', 'driver-a', { databaseStatus: 'completed' }),
  ];
  const action = () => { throw new Error('SSR must not invoke an action'); };
  const props = { drivers, loads, onDropOnOffer: action, onSendOffer: action, onDeleteLoad: action, onOpenDocs: action };
  const renderMarkup = element => renderToString(element).replace(/<!--.*?-->/g, '');
  const render = overrides => renderMarkup(React.createElement(LoadsWorkspace, { ...props, ...overrides }));
  const text = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const translated = key => text(i18n.t(key));
  const cards = html => html.split('class="driver-trip-card"').slice(1);
  const card = (html, number) => {
    const result = cards(html).find(fragment => fragment.includes(`<strong>#${number}</strong>`));
    assert.ok(result, `Card ${number} is rendered`);
    return result;
  };
  const stageColumns = html => [...html.matchAll(/class="kanban-column driver-board-column stage-([a-z_]+)/g)].map(match => match[1]);

  for (const locale of ['ru', 'uz', 'en']) {
    await i18n.changeLanguage(locale);
    const html = render();
    assert.ok(html.includes(`<h1>${translated('loadsWorkspace.title')}</h1>`), `${locale}: translated title`);
    for (const key of ['loadsWorkspace.boardTitle', 'loadsWorkspace.searchPlaceholder', 'loadsWorkspace.driverFilter',
      'loadsWorkspace.allDrivers', 'loadsWorkspace.unassignedDriver', 'loadsWorkspace.totalLoads',
      'loadsWorkspace.activeLoads', 'loadsWorkspace.completedLoads', 'loadsWorkspace.unassignedLoads',
      'loadsWorkspace.driversCount', 'loads.statusFilter', 'loads.dateFilter']) {
      assert.ok(i18n.exists(key, { lng: locale }), `${locale}: catalog includes ${key}`);
      assert.ok(html.includes(translated(key)), `${locale}: renders ${key}`);
    }
    assert.deepEqual(stageColumns(html), ['unassigned', 'assigned', 'picked_up', 'on_road', 'completed'], `${locale}: unassigned plus the four driver-board stages`);
    assert.ok(html.includes('--board-column-count:5'), `${locale}: grid matches visible stages`);
    assert.equal(cards(html).length, loads.length, `${locale}: all loads, not one driver's subset`);
    assert.ok(!html.includes('loadsWorkspace.'), `${locale}: no raw translation keys`);
    assert.ok(!html.includes(`<span>${translated('loads.table')}</span>`), `${locale}: table toggle absent`);
    assert.ok(!html.includes('<table'), `${locale}: stored table preference ignored`);

    const alpha = card(html, 'TEST-ASSIGNED');
    const beta = card(html, 'TEST-PICKED-UP');
    assert.ok(alpha.includes('Test Driver Alpha'), `${locale}: Alpha assigned-driver identity`);
    assert.ok(beta.includes('Test Driver Beta'), `${locale}: Beta assigned-driver identity`);
    assert.ok(alpha.includes('class="fleet-load-driver"'), `${locale}: compact driver row`);
    assert.ok(!alpha.includes('class="fleet-load-card-actions"'), `${locale}: active load has no empty action footer`);
    assert.ok(!html.includes('fleet-load-driver-avatar'), `${locale}: no extra driver avatar`);
    assert.ok(!html.includes('fleet-load-card-footer'), `${locale}: no duplicated card footer`);
    const delivered = card(html, 'TEST-DELIVERED');
    assert.ok(delivered.includes(`class="driver-trip-stage stage-on_road">${translated('loads.awaitingCompletion')}</span>`), `${locale}: delivered retains awaiting-completion label`);
    const onRoadColumn = html.split('class="kanban-column driver-board-column stage-on_road')[1].split('class="kanban-column')[0];
    assert.ok(onRoadColumn.includes('TEST-ON-ROAD') && onRoadColumn.includes('TEST-DELIVERED'), `${locale}: delivered load remains in the on-road column`);
    const unassigned = card(html, 'TEST-UNASSIGNED');
    assert.ok(unassigned.includes(translated('loads.unassigned')), `${locale}: unassigned driver label`);
    assert.ok(unassigned.includes('class="fleet-load-assign"'), `${locale}: assign action`);
    assert.ok(unassigned.includes('class="fleet-load-delete"'), `${locale}: delete action`);
    assert.ok(unassigned.includes(text(i18n.t('loads.offeredDrivers', { count: 2 }))), `${locale}: offered-driver count retained`);
    assert.ok(!alpha.includes('class="fleet-load-delete"'), `${locale}: active assigned load cannot be deleted`);
    assert.ok(card(html, 'TEST-COMPLETED').includes('class="fleet-load-documents"'), `${locale}: completed documents action`);
    assert.match(html, /<input[^>]*type="file"[^>]*accept="[^"]*\.pdf/, `${locale}: PDF input`);
    assert.ok(html.includes(translated('loadsWorkspace.importPdf')), `${locale}: PDF action label`);

    const busyHtml = render({ isAiProcessing: true });
    assert.match(busyHtml, /<button[^>]*class="driver-trip-add"[^>]*disabled=""/, `${locale}: busy import button disabled`);
    assert.match(busyHtml, /<input[^>]*type="file"[^>]*disabled=""/, `${locale}: busy file input disabled`);
    assert.ok(busyHtml.includes(translated('common.loading')), `${locale}: translated busy text`);
    assert.ok(!busyHtml.includes('common.processing'), `${locale}: no missing busy translation`);
  }

  const emptyHtml = render({ loads: [], drivers: [] });
  assert.equal(cards(emptyHtml).length, 0);
  assert.deepEqual(stageColumns(emptyHtml), ['assigned', 'picked_up', 'on_road', 'completed']);
  assert.equal(emptyHtml.split('class="driver-board-empty"').length - 1, 4);
  assert.ok(emptyHtml.includes(translated('drivers.noTripsInStage')));
  assert.ok(!emptyHtml.includes('NaN'));

  const assignedLoads = loads.filter(item => item.status !== 'UNASSIGNED');
  const assignedHtml = render({ loads: assignedLoads });
  assert.deepEqual(stageColumns(assignedHtml), ['assigned', 'picked_up', 'on_road', 'completed']);
  assert.ok(assignedHtml.includes('--board-column-count:4'));
  assert.equal(cards(assignedHtml).length, assignedLoads.length);
  assert.ok(assignedHtml.includes('TEST-DELIVERED'), 'Grouping stages never hides delivered loads');

  const missingHtml = render({
    loads: [{ id: 'missing', loadNumber: 'MISSING', status: 'ASSIGNED', driverId: 'missing-driver' }],
    drivers: [{ id: 'nameless-driver' }],
  });
  const missingCard = card(missingHtml, 'MISSING');
  assert.ok(missingCard.includes(translated('loadsWorkspace.missingDriver')));
  assert.ok(missingCard.includes(translated('common.notProvided')));
  assert.ok(missingCard.includes(translated('inbox.brokerMissing')));
  assert.ok(missingCard.includes('<strong>—</strong>'));
  assert.ok(!missingCard.includes('driver-trip-card-date'), 'Missing date is not invented');
  assert.ok(!missingHtml.includes('undefined'));
  assert.ok(!missingHtml.includes('NaN'));

  const noActionsHtml = render({ onDropOnOffer: undefined, onSendOffer: undefined, onDeleteLoad: undefined, onOpenDocs: undefined });
  for (const className of ['driver-trip-add', 'fleet-load-assign', 'fleet-load-delete', 'fleet-load-documents']) {
    assert.ok(!noActionsHtml.includes(`class="${className}"`), `No unsupported ${className} action`);
  }
  assert.ok(!noActionsHtml.includes('class="fleet-load-card-actions"'), 'No empty action rows');
  assert.ok(!noActionsHtml.includes('type="file"'));

  const driverHtml = renderMarkup(React.createElement(KanbanBoard, {
    ...props, loads: [loads[0], ...loads.filter(item => item.driverId === 'driver-a')],
    boardOnly: true, driverWorkspace: true, includeUnassigned: false,
    hideStageFilters: true, groupDeliveredWithOnRoad: true,
  }));
  assert.deepEqual(stageColumns(driverHtml), ['assigned', 'picked_up', 'on_road', 'completed']);
  assert.ok(driverHtml.includes(translated('drivers.tripHistory')));
  assert.ok(driverHtml.includes(translated('drivers.tripSearchPlaceholder')));
  assert.ok(!driverHtml.includes('TEST-UNASSIGNED'));
  assert.ok(!driverHtml.includes('fleet-driver-filter'));
  assert.ok(!driverHtml.includes('fleet-load-card-footer'));
  assert.ok(!driverHtml.includes('<table'));
  assert.equal(networkAttempts, 0);
  console.log('LoadsWorkspace render: 3 locales, 4/5 fleet stages, grouped delivered loads, compact driver identity, actions, PDF/busy, empty/missing fields and legacy driver board passed; no network.');
} finally {
  globalThis.fetch = previousFetch;
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete globalThis.localStorage;
  await server.close();
}
