import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driverTrips, filteredTrips, fleetLivePosition, isActiveFleetLoad, loadMapStops, overlayMapPadding,
  selectedDriverTrip, shouldRefreshCompletedTrack, stopCity, stopStreet, tripMatchesSearch, tripTimestamp,
} from './fleetMapModel.js';

const current = { id: 'current', driverId: 'a', loadNumber: '#1103881', status: 'ON_ROAD',
  origin: { city: 'Lawrence', state: 'MA', address: '485 S Union', postalCode: '01843', date: '2026-10-04T09:00:00Z' },
  destination: { city: 'Allentown', state: 'PA', address: '7150 Ambassador Dr' } };
const older = { id: 'older', driverId: 'a', loadNumber: '#3098315', status: 'COMPLETED',
  origin: { city: 'Phoenix', state: 'AZ', date: '2026-09-30T09:00:00Z' } };

test('map mount before workspace data arrives never reads an absent previous trip', () => {
  for (const previous of [null, undefined, {}]) {
    assert.equal(shouldRefreshCompletedTrack(previous, { isVisible: true, isActive: false }), false);
    assert.equal(shouldRefreshCompletedTrack(previous, { driverId: 'a', loadId: 'current', isVisible: true, isActive: true }), false);
  }
});

test('completion refresh is restricted to the same visible real driver and trip', () => {
  const previous = { driver: 'a', load: 'current', active: true };
  const next = { driverId: 'a', loadId: 'current', isVisible: true, isActive: false };
  assert.equal(shouldRefreshCompletedTrack(previous, next), true);
  for (const change of [{ isVisible: false }, { isActive: true }, { driverId: 'b' },
    { loadId: 'other' }, { driverId: undefined }, { loadId: undefined }]) {
    assert.equal(shouldRefreshCompletedTrack(previous, { ...next, ...change }), false);
  }
  assert.equal(shouldRefreshCompletedTrack({ ...previous, active: false }, next), false);
  assert.equal(shouldRefreshCompletedTrack({ active: true }, { isVisible: true, isActive: false }), false);
});

test('workspace loading, completion and subsequent updates produce only one completion refresh', () => {
  let previous = null;
  let refreshes = 0;
  for (const next of [
    { isVisible: true, isActive: false },
    { driverId: 'a', isVisible: true, isActive: false },
    { driverId: 'a', loadId: 'current', isVisible: true, isActive: true },
    { driverId: 'a', loadId: 'current', isVisible: true, isActive: false },
    { driverId: 'a', loadId: 'current', isVisible: true, isActive: false },
  ]) {
    if (shouldRefreshCompletedTrack(previous, next)) refreshes++;
    previous = { driver: next.driverId, load: next.loadId, active: next.isActive };
  }
  assert.equal(refreshes, 1);
});

test('search finds load numbers, city/state, street and ZIP without case/punctuation sensitivity', () => {
  for (const query of ['#1103881', '110 3881', 'ALLENTOWN, PA', '7150 ambassador', '01843', 'Lawrence MA']) {
    assert.equal(tripMatchesSearch(current, query), true, query);
  }
  assert.equal(tripMatchesSearch(current, '7150 Phoenix'), false);
  assert.equal(tripMatchesSearch(current, ''), true);
  assert.equal(tripMatchesSearch({}, '1103881'), false);
});

test('search includes intermediate document stops without modifying their contents', () => {
  const load = { ...current, driverBrief: { stops: [{ addressLine: '12 Café Road', city: 'Hartford', region: 'CT' }] } };
  assert.equal(tripMatchesSearch(load, 'cafe road hartford'), true);
  assert.equal(load.driverBrief.stops[0].addressLine, '12 Café Road');
});

test('driver scope includes previous tracking sessions but excludes unrelated loads', () => {
  const reassigned = { id: 'reassigned', driverId: 'b', origin: { date: '2026-10-03T09:00:00Z' } };
  const unrelated = { id: 'unrelated', driverId: 'b' };
  const input = [older, unrelated, reassigned, current];
  const trips = driverTrips(input, 'a', [{ load_id: 'reassigned', started_at: '2026-10-01T08:00:00Z' }]);
  assert.deepEqual(trips.map(load => load.id), ['current', 'reassigned', 'older']);
  assert.deepEqual(input.map(load => load.id), ['older', 'unrelated', 'reassigned', 'current']);
  assert.deepEqual(driverTrips(input, null), []);
});

test('changing drivers or deleting a selected load cannot show the previous driver route', () => {
  assert.equal(selectedDriverTrip([current, older], current, 'older'), older);
  assert.equal(selectedDriverTrip([current, older], current, 'other-driver-trip'), current);
  assert.equal(selectedDriverTrip([older], null, 'deleted'), older);
  assert.equal(selectedDriverTrip([], null, 'current'), null);
});

test('date filtering uses session dates, excludes unknown/future dates, and preserves all-date results', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const unknown = { id: 'unknown' };
  const future = { id: 'future', origin: { date: '2026-10-08T08:00:00Z' } };
  assert.deepEqual(filteredTrips([current, older, unknown, future], { period: '7', now }), [current, older]);
  assert.deepEqual(filteredTrips([current, older], { query: 'Phoenix', period: '30', now }), [older]);
  assert.equal(filteredTrips([unknown], { period: 'all', now }).length, 1);
  const sessions = [{ load_id: 'older', started_at: '2026-09-01T09:00:00Z' }];
  assert.deepEqual(filteredTrips([older], { period: '30', sessions, now }), []);
  assert.equal(tripTimestamp(unknown), null);
  assert.equal(tripTimestamp(older, sessions), Date.parse('2026-09-01T09:00:00Z'));
});

test('stop labels prefer city/state and never invent a street from a city fallback', () => {
  assert.equal(stopCity(current.origin), 'Lawrence, MA');
  assert.equal(stopStreet(current.origin), '485 S Union');
  assert.equal(stopStreet({ city: 'Flanders', state: 'NJ', address: 'Flanders, NJ' }), '');
  assert.equal(stopCity(null), '—');
});

test('map stops use actual endpoint coordinates and preserve intermediate stop sequence', () => {
  assert.deepEqual(loadMapStops(null), []);
  const load = { ...current, origin: { ...current.origin, lat: 42.7, lng: -71.1 },
    destination: { ...current.destination, lat: 40.6, lng: -75.4 }, driverBrief: { stops: [
      { role: 'pickup' }, { role: 'delivery', lat: 41.5, lng: -72.2 }, { role: 'delivery' },
    ] } };
  assert.deepEqual(loadMapStops(load).map(({ sequence, role, latitude, longitude }) => ({ sequence, role, latitude, longitude })), [
    { sequence: 1, role: 'pickup', latitude: 42.7, longitude: -71.1 },
    { sequence: 2, role: 'delivery', latitude: 41.5, longitude: -72.2 },
    { sequence: 3, role: 'delivery', latitude: 40.6, longitude: -75.4 },
  ]);
  assert.equal(loadMapStops(current)[0].latitude, undefined);
});

test('multiple pickups and deliveries retain route order and independent marker numbers', () => {
  const stops = loadMapStops({ driverBrief: { stops: [
    { role: 'pickup', addressLine: '11 First Street', city: 'One', region: 'NY' },
    { role: 'pickup', addressLine: '22 Second Street', city: 'Two', region: 'NJ' },
    { role: 'delivery', addressLine: '33 Third Street', city: 'Three', region: 'PA' },
    { role: 'delivery', addressLine: '44 Fourth Street', city: 'Four', region: 'MA' },
  ] } });
  assert.deepEqual(stops.map(stop => stop.markerLabel), ['P1', 'P2', 'D1', 'D2']);
  assert.deepEqual(stops.map(stop => stop.sequence), [1, 2, 3, 4]);
  assert.equal(stops[1].address, '22 Second Street');
  assert.equal(stops[1].state, 'NJ');
  assert.equal(stops[2].address, '33 Third Street');
  assert.deepEqual(loadMapStops({ stops: [{ role: 'pickup' }, { role: 'delivery' }, { role: 'pickup' }, { role: 'delivery' }] })
    .map(stop => stop.markerLabel), ['P1', 'D1', 'P2', 'D2']);
});

test('active route and current position require the same active driver/load', () => {
  const driver = { id: 'a', isOnline: true, lat: 0, lng: 0 };
  assert.equal(isActiveFleetLoad(current, driver), true);
  assert.deepEqual(fleetLivePosition(current, driver), { lat: 0, lng: 0, source: 'live' });
  assert.equal(fleetLivePosition(older, driver), null);
  assert.equal(isActiveFleetLoad({ ...current, databaseStatus: 'completed' }, driver), false);
  assert.equal(isActiveFleetLoad({ ...current, databaseStatus: 'cancelled' }, driver), false);
  assert.equal(fleetLivePosition(current, { ...driver, id: 'b' }), null);
});

test('offline GPS fallback is labelled recorded and never masquerades as current location', () => {
  const driver = { id: 'a', isOnline: false, lat: 55, lng: 10 };
  const points = [{ latitude: 42, longitude: -71 }, { latitude: 43, longitude: -72 }, { latitude: 200, longitude: 0 }];
  assert.deepEqual(fleetLivePosition(current, driver, points), { lat: 43, lng: -72, source: 'recorded' });
  assert.equal(fleetLivePosition(current, driver, []), null);
  assert.equal(fleetLivePosition(older, driver, points), null);
});

test('camera padding reserves overlays while leaving space on desktop, tablet and mobile', () => {
  const desktop = overlayMapPadding({ width: 1400, height: 900, leftPanelWidth: 320, bottomPanelHeight: 150 });
  assert.equal(desktop.left, 372);
  assert.equal(desktop.bottom, 202);
  const tablet = overlayMapPadding({ width: 700, height: 500, leftPanelWidth: 320, bottomPanelHeight: 240 });
  assert.ok(tablet.left + tablet.right < 700);
  assert.ok(tablet.top + tablet.bottom < 500);
  const mobile = overlayMapPadding({ width: 360, height: 430 });
  assert.equal(mobile.left, 36);
  assert.equal(mobile.bottom, 44);
});
