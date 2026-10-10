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
  const { default: CreateLoadModal } = await server.ssrLoadModule('/src/components/CreateLoadModal.jsx');
  const { default: QuickDriverModal } = await server.ssrLoadModule('/src/components/QuickDriverModal.jsx');
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
  const assertSummary = (html, { total, active, completed, driverCount }, label) => {
    for (const [key, count] of [['totalLoads', total], ['activeLoads', active], ['completedLoads', completed]]) {
      assert.ok(html.includes(`<span>${translated(`loadsWorkspace.${key}`)}</span><strong>${count}</strong>`), `${label}: ${key} counts visible loads only`);
    }
    assert.ok(html.includes(`${translated('loadsWorkspace.driversCount')}: ${driverCount}</p>`), `${label}: distinct visible drivers`);
    assert.ok(!html.includes(translated('loadsWorkspace.unassignedLoads')), `${label}: no unassigned summary`);
  };

  for (const locale of ['ru', 'uz', 'en']) {
    await i18n.changeLanguage(locale);
    const html = render();
    assert.ok(html.includes(`<h1>${translated('loadsWorkspace.title')}</h1>`), `${locale}: translated title`);
    for (const key of ['loadsWorkspace.boardTitle', 'loadsWorkspace.searchPlaceholder', 'loadsWorkspace.driverFilter',
      'loadsWorkspace.allDrivers', 'loadsWorkspace.totalLoads',
      'loadsWorkspace.activeLoads', 'loadsWorkspace.completedLoads',
      'loadsWorkspace.driversCount', 'loads.statusFilter', 'loads.dateFilter']) {
      assert.ok(i18n.exists(key, { lng: locale }), `${locale}: catalog includes ${key}`);
      assert.ok(html.includes(translated(key)), `${locale}: renders ${key}`);
    }
    assert.deepEqual(stageColumns(html), ['assigned', 'picked_up', 'on_road', 'completed'], `${locale}: exactly four dispatched stages`);
    assert.ok(html.includes('--board-column-count:4'), `${locale}: grid matches visible stages`);
    assert.equal(cards(html).length, 5, `${locale}: dispatched loads from all drivers, without draft or offer cards`);
    assertSummary(html, { total: 5, active: 4, completed: 1, driverCount: 2 }, locale);
    assert.ok(!html.includes('<option value="UNASSIGNED">'), `${locale}: no unassigned filter`);
    assert.ok(!html.includes(translated('loadsWorkspace.unassignedDriver')), `${locale}: no unassigned driver option`);

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
    assert.ok(!html.includes('TEST-UNASSIGNED'), `${locale}: old unassigned record is absent from workspace markup`);
    assert.ok(!html.includes('saved-load-recovery'), `${locale}: no separate saved-drafts panel`);
    assert.ok(!html.includes('class="fleet-load-assign"'), `${locale}: no legacy assign action`);
    assert.ok(!html.includes('class="fleet-load-delete"'), `${locale}: no hidden-draft delete action`);
    assert.ok(!html.includes(text(i18n.t('loads.offeredDrivers', { count: 2 }))), `${locale}: no offered-driver count`);

    assert.ok(!alpha.includes('class="fleet-load-delete"'), `${locale}: active assigned load cannot be deleted`);
    assert.ok(card(html, 'TEST-COMPLETED').includes('class="fleet-load-documents"'), `${locale}: completed documents action`);
    assert.match(html, /<input[^>]*type="file"[^>]*accept="[^"]*\.pdf/, `${locale}: PDF input`);
    assert.ok(html.includes(translated('loadsWorkspace.importPdf')), `${locale}: PDF action label`);
    assert.ok(html.includes(translated('loadTrash.title')), `${locale}: trash remains available`);


    const busyHtml = render({ isAiProcessing: true });
    assert.match(busyHtml, /<button[^>]*class="driver-trip-add"[^>]*disabled=""/, `${locale}: busy import button disabled`);
    assert.match(busyHtml, /<input[^>]*type="file"[^>]*disabled=""/, `${locale}: busy file input disabled`);
    assert.ok(busyHtml.includes(translated('common.loading')), `${locale}: translated busy text`);
    assert.ok(!busyHtml.includes('common.processing'), `${locale}: no missing busy translation`);
  }

  const manualWithoutDriver = renderMarkup(React.createElement(CreateLoadModal, { isOpen:true, drivers, onClose:action, onCreateLoad:action }));
  assert.match(manualWithoutDriver, /<button[^>]*type="submit"[^>]*disabled=""/);
  const manualWithDriver = renderMarkup(React.createElement(CreateLoadModal, { isOpen:true, drivers, onClose:action, onCreateLoad:action, initialDriverId:'driver-a' }));
  assert.match(manualWithDriver, /<button[^>]*type="submit"[^>]*disabled=""/, 'known driver must finish the scoped pay-settings check before manual creation');
  const savedDraft = renderMarkup(React.createElement(QuickDriverModal, { isOpen:true, drivers, onClose:action, onConfirm:action, initialDriverId:'driver-a',
    loadData:{...loads[0], lifecycleStatus:'draft', databaseStatus:'draft', source:'saved'},
  }));
  assert.ok(!savedDraft.includes(translated('loads.closedCannotOffer')), 'manual draft remains assignable through approval recovery');
  assert.ok(!/<button[^>]*type="submit"[^>]*disabled=""/.test(savedDraft));
  assert.ok(savedDraft.includes('Test Driver Alpha'), 'fixed driver remains visible');
  assert.ok(!savedDraft.includes('Test Driver Beta'), 'fixed-driver recovery does not offer another driver');
  assert.ok(!savedDraft.includes('role="radiogroup"'), 'fixed-driver recovery does not render a driver picker');
  assert.ok(!savedDraft.includes(`placeholder="${translated('drivers.searchPlaceholder')}"`), 'fixed-driver recovery does not render driver search');

  const missingFixedDriver = renderMarkup(React.createElement(QuickDriverModal, { isOpen:true, drivers, onClose:action, onConfirm:action, initialDriverId:'missing-driver',
    loadData:{...loads[0], lifecycleStatus:'draft', databaseStatus:'draft', source:'saved'},
  }));
  assert.match(missingFixedDriver, /<button[^>]*type="submit"[^>]*disabled=""/, 'missing fixed driver cannot be submitted');
  assert.ok(!missingFixedDriver.includes('role="radiogroup"'), 'missing fixed driver does not silently fall back to another driver');

  const selectableDriver = renderMarkup(React.createElement(QuickDriverModal, { isOpen:true, drivers, onClose:action, onConfirm:action,
    loadData:{...loads[0], lifecycleStatus:'draft', databaseStatus:'draft', source:'saved'},
  }));
  assert.ok(selectableDriver.includes('role="radiogroup"'), 'driver picker remains available without fixed context');
  assert.ok(selectableDriver.includes(`placeholder="${translated('drivers.searchPlaceholder')}"`), 'unbound recovery retains driver search');
  assert.ok(selectableDriver.includes('Test Driver Alpha') && selectableDriver.includes('Test Driver Beta'), 'unbound recovery offers available drivers');
  assert.match(selectableDriver, /<button[^>]*type="submit"[^>]*disabled=""/, 'unbound recovery requires a driver selection');

  const emptyHtml = render({ loads: [], drivers: [] });
  assert.equal(cards(emptyHtml).length, 0);
  assert.deepEqual(stageColumns(emptyHtml), ['assigned', 'picked_up', 'on_road', 'completed']);
  assert.equal(emptyHtml.split('class="driver-board-empty"').length - 1, 4);
  assert.ok(emptyHtml.includes(translated('drivers.noTripsInStage')));
  assert.ok(!emptyHtml.includes('NaN'));
  assertSummary(emptyHtml, { total: 0, active: 0, completed: 0, driverCount: 0 }, 'Empty board');

  const draftOnlyHtml = render({ loads: ['draft', 'review', 'ready_for_offer', 'offered'].map((databaseStatus, index) =>
    load(`HIDDEN-${databaseStatus}`, 'UNASSIGNED', index === 0 ? 'driver-a' : null, { databaseStatus })) });
  assert.deepEqual(stageColumns(draftOnlyHtml), ['assigned', 'picked_up', 'on_road', 'completed']);
  assert.ok(draftOnlyHtml.includes('--board-column-count:4'), 'Draft-only board keeps four columns');
  assert.equal(cards(draftOnlyHtml).length, 0, 'Draft and offer records never appear as dispatched cards');
  assert.equal(draftOnlyHtml.split('class="driver-board-empty"').length - 1, 4);
  assert.ok(!draftOnlyHtml.includes('saved-load-recovery'), 'Draft-only workspace has no separate saved-drafts panel');
  for (const status of ['draft', 'review', 'ready_for_offer', 'offered']) assert.ok(!draftOnlyHtml.includes(`HIDDEN-${status}`), `${status} record stays out of workspace markup`);
  assertSummary(draftOnlyHtml, { total: 0, active: 0, completed: 0, driverCount: 0 }, 'Draft-only board');
  assert.ok(draftOnlyHtml.includes(translated('loadsWorkspace.importPdf')), 'Draft-only board retains PDF import');
  assert.ok(draftOnlyHtml.includes(translated('loadTrash.title')), 'Draft-only board retains trash');

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
  console.log('LoadsWorkspace render: 3 locales, 4 dispatched stages, visible-only totals, no saved-drafts panel or draft/offer records, fixed/unbound driver recovery, grouped delivered loads, PDF/busy/trash, empty/missing fields and driver board passed; no network.');
} finally {
  globalThis.fetch = previousFetch;
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete globalThis.localStorage;
  await server.close();
}
