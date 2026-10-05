import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SWRConfig, unstable_serialize } from 'swr';
import { createServer } from 'vite';

// Component-level rendering only: no browser, listener, or authenticated API.
const server = await createServer({
  configFile: false,
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { default: FleetMap } = await server.ssrLoadModule('/src/components/FleetMap.jsx');
  const { WorkspaceCache } = await server.ssrLoadModule('/src/hooks/WorkspaceCache.jsx');
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.js');
  const drivers = [
    { id: 'test-driver-a', name: 'Test Driver A', driverNumber: '#TEST-A', truck: 'Test Truck', isOnline: true },
    { id: 'test-driver-b', name: 'Test Driver B', isOnline: false },
  ];
  const loads = [
    { id: 'test-current', driverId: 'test-driver-a', loadNumber: '#TEST-CURRENT', status: 'ON_ROAD',
      databaseStatus: 'in_progress', broker: 'Test Broker', equipment: 'Test Trailer', rate: 1050, rateKnown: true,
      distanceMiles: 336, distanceKnown: true,
      origin: { city: 'Test Pickup', state: 'MA', address: '123 Test Street' },
      destination: { city: 'Test Delivery', state: 'PA', address: '456 Test Road' } },
    { id: 'test-history', driverId: 'test-driver-a', loadNumber: '#TEST-HISTORY', status: 'COMPLETED',
      databaseStatus: 'completed', origin: { city: 'Test Past', state: 'NY', date: '2026-09-30T09:00:00Z' },
      destination: { city: 'Test Destination', state: 'NJ' } },
    { id: 'test-unrelated', driverId: 'test-driver-b', loadNumber: '#TEST-UNRELATED', status: 'ON_ROAD' },
  ];
  const render = (props, fallback = {}) => renderToString(React.createElement(WorkspaceCache, null,
    React.createElement(SWRConfig, { value: { fallback } },
      React.createElement(FleetMap, { drivers, loads, ...props }))));

  for (const locale of ['uz', 'ru', 'en']) {
    await i18n.changeLanguage(locale);
    const html = render();
    assert.ok(html.includes(i18n.t('map.workspaceTitle')), `${locale}: translated page title`);
    assert.ok(html.includes('id="fleet-driver-picker"'), `${locale}: driver picker`);
    assert.ok(html.includes('#TEST-CURRENT'), `${locale}: current load`);
    assert.ok(html.includes('#TEST-HISTORY'), `${locale}: own historical load`);
    assert.ok(!html.includes('#TEST-UNRELATED'), `${locale}: no unrelated driver load`);
    assert.ok(html.includes('123 Test Street'), `${locale}: pickup address`);
    assert.ok(html.includes('456 Test Road'), `${locale}: delivery address`);
    assert.ok(html.includes(i18n.t('map.tripSearch')), `${locale}: translated address/load search`);
    assert.ok(html.includes(i18n.t('map.openTrip')), `${locale}: trip details action`);
    assert.ok(!html.includes('map.workspaceTitle'), `${locale}: no untranslated keys`);
  }

  const emptyHtml = render({ drivers: [], loads: [] });
  assert.ok(emptyHtml.includes(i18n.t('drivers.noDrivers')));
  assert.ok(emptyHtml.includes(i18n.t('map.noDriverLoad')));
  assert.match(emptyHtml, /id="fleet-driver-picker"[^>]*disabled/);
  assert.ok(!emptyHtml.includes('NaN'));

  const missingHtml = render({ loads: [{ ...loads[0], rate: 0, rateKnown: false,
    distanceMiles: 0, distanceKnown: false }] });
  assert.match(missingHtml, /fleet-map-dock-action"><strong>—<\/strong>/);
  assert.ok(!missingHtml.includes('0 mi'));

  const multiple = { ...loads[0], driverBrief: { stops: [
    { role: 'pickup', addressLine: '11 First Pickup', city: 'Test A', region: 'NY' },
    { role: 'pickup', addressLine: '22 Second Pickup', city: 'Test B', region: 'NJ' },
    { role: 'delivery', addressLine: '33 First Delivery', city: 'Test C', region: 'PA' },
    { role: 'delivery', addressLine: '44 Second Delivery', city: 'Test D', region: 'MA' },
  ] } };
  const multiHtml = render({ loads: [multiple] });
  for (const text of ['P1', 'P2', 'D1', 'D2', '11 First Pickup', '22 Second Pickup', '33 First Delivery', '44 Second Delivery']) {
    assert.ok(multiHtml.includes(text), `Multiple stops: ${text}`);
  }
  assert.ok(multiHtml.includes(i18n.t('map.plannedRoute')));
  assert.ok(multiHtml.includes(i18n.t('map.liveUnavailable')));
  const liveHtml = render({ loads: [multiple], drivers: [{ ...drivers[0], lat: 42, lng: -71 }] });
  assert.ok(liveHtml.includes(i18n.t('map.liveLocation')));
  const completedHtml = render({ loads: [{ ...multiple, status: 'COMPLETED', databaseStatus: 'completed' }] });
  assert.ok(completedHtml.includes(i18n.t('map.plannedRoute')));
  assert.ok(!completedHtml.includes(i18n.t('map.recordedRoute')), 'Do not label the planned road route as actual GPS');
  assert.ok(completedHtml.includes(i18n.t('map.trackLoading')));
  assert.ok(!completedHtml.includes(i18n.t('map.liveLocation')));

  const completedGpsHtml = render({ loads: [{ ...multiple, status: 'COMPLETED', databaseStatus: 'completed' }] }, {
    [unstable_serialize(['driver-track', drivers[0].id, multiple.id])]: [
      { id: 'test-gps-a', assignment_id: 'test-session', latitude: 40, longitude: -75, captured_at: '2026-10-01T10:00:00Z' },
      { id: 'test-gps-b', assignment_id: 'test-session', latitude: 41, longitude: -74, captured_at: '2026-10-01T11:00:00Z' },
    ],
  });
  assert.ok(completedGpsHtml.includes(i18n.t('map.plannedRoute')));
  assert.ok(completedGpsHtml.includes(i18n.t('map.recordedRoute')), 'Completed GPS has a separate legend');
  assert.ok(completedGpsHtml.includes('fleet-map-gps-legend'));
  assert.ok(!completedGpsHtml.includes(i18n.t('map.liveLocation')));

  // Check the changed map catalog only. The older all-app scanner incorrectly
  // treats useWorkspaceView('map.driver') and other cache keys as translations.
  const source = await readFile(new URL('../src/components/FleetMap.jsx', import.meta.url), 'utf8');
  const cacheKeys = new Set([...source.matchAll(/useWorkspaceView\('([^']+)'/g)].map(match => match[1]));
  const presentationKeys = new Set([...source.matchAll(/'((?:map|common|drivers|inbox)\.[A-Za-z]+)'/g)]
    .map(match => match[1]).filter(key => !cacheKeys.has(key)));
  for (const locale of ['uz', 'ru', 'en']) {
    for (const key of presentationKeys) assert.ok(i18n.exists(key, { lng: locale }), `${locale}: missing ${key}`);
  }
  console.log('FleetMap render: 3 locales, driver-scoped history, multiple pickups/deliveries, active/completed/live/missing states passed.');
} finally {
  await server.close();
}
