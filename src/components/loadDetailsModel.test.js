import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadDetails, loadCurrentLocation, latestPickupRouteStops, pickupEstimateScope, selectPickupEstimate, savedLoadRoadSummary, savedStopContactPhone } from './loadDetailsModel.js';

test('detail cards retain all pickups and deliveries with independent labels and appointments', () => {
  const details = buildLoadDetails({ driverBrief: { stops: [
    { role: 'pickup', facility: 'First', address: '1 Main St', date: '2026-10-05', timezone: 'America/New_York' },
    { role: 'pickup', facility: 'Second', address: '2 Main St' },
    { role: 'delivery', facility: 'Third', address: '3 Main St' },
    { role: 'delivery', facility: 'Fourth', address: '4 Main St' },
  ] } });
  assert.deepEqual(details.stops.map(stop => stop.markerLabel), ['P1', 'P2', 'D1', 'D2']);
  assert.deepEqual(details.stops.map(stop => stop.facility), ['First', 'Second', 'Third', 'Fourth']);
  assert.equal(details.stops[0].appointment, '2026-10-05');
  assert.equal(details.stops[0].timezone, 'America/New_York');
});

test('durable document remains available when temporary URL is missing', () => {
  const details = buildLoadDetails({ documentMeta: { rateCon: { current_version_id: 'version' } } });
  assert.equal(details.documentCount, 1);
  assert.equal(details.documents[0].available, true);
});

test('load details preserve every operational field shown by the modal', () => {
  const details = buildLoadDetails({
    loadNumber: '#38495207', databaseStatus: 'completed', broker: 'TQL',
    brokerContact: 'Jane', brokerPhone: '+1 555', brokerEmail: 'jane@example.com',
    rate: 3500, distanceMiles: 57.72, ratePerMile: 60.64,
    equipment: 'Reefer', commodity: 'Chocolate', weightLbs: 16000,
    temperature: 34, pallets: 18, cases: 900, isHazmat: false,
    specialInstructions: 'Use rear dock', requirements: ['E-Track'], warnings: [
      { id: 'warning-1', code: 'sample', params: { field: 'rate' } },
      { id: 'warning-2', code: 'sample', params: { field: 'rate' } },
    ],
    origin: { facility: 'FOUR SEASONS', address: '400 Wabash Rd', appointmentAt: '2026-09-23T08:59:00Z', timezone: 'America/New_York' },
    destination: { city: 'Mechanicsburg', state: 'PA', postalCode: '17055', date: '2026-09-23T16:00:00Z' },
    documents: {
      rateCon: '/rate.pdf',
      shipperBol: '/bol.pdf',
      receiverPod: null,
      receipt: '/receipt.jpg',
    },
  }, { name: 'amin1' });

  assert.equal(details.driverName, 'amin1');
  assert.equal(details.pickup.address, '400 Wabash Rd');
  assert.equal(details.pickup.timezone, 'America/New_York');
  assert.equal(details.delivery.address, 'Mechanicsburg, PA, 17055');
  assert.equal(details.delivery.appointment, '2026-09-23T16:00:00Z');
  assert.deepEqual(details.requirements, ['E-Track']);
  assert.equal(details.documentCount, 3);
  assert.deepEqual(details.documents.map(({ id, url }) => [id, Boolean(url)]), [
    ['rateCon', true],
    ['shipperBol', true],
    ['receiverPod', false],
    ['receipt', true],
  ]);
  assert.equal(details.isHazmat, false);
  assert.equal(details.warnings.length, 1);
});


test('persisted extractor and database stop timestamps retain their own appointment zones', () => {
  const details = buildLoadDetails({
    origin: { appointmentAt: '2026-10-01T01:00:00Z', timezone: 'UTC' },
    destination: { appointmentAt: '2026-10-01T02:00:00Z', timezone: 'UTC' },
    driverBrief: { stops: [
      { role: 'pickup', appointmentFrom: '2026-10-05T08:00:00-04:00', appointmentTimezone: 'America/New_York' },
      { role: 'pickup', appointment_from: '2026-10-05T12:00:00-05:00', appointment_timezone: 'America/Chicago' },
      { role: 'delivery', appointmentAt: '2026-10-06T10:00:00-04:00', timezone: 'America/Detroit' },
      { role: 'delivery', date: '2026-10-07', timezone: 'America/New_York' },
    ] },
  });
  assert.deepEqual(details.stops.map(stop => [stop.appointment, stop.timezone]), [
    ['2026-10-05T08:00:00-04:00', 'America/New_York'],
    ['2026-10-05T12:00:00-05:00', 'America/Chicago'],
    ['2026-10-06T10:00:00-04:00', 'America/Detroit'],
    ['2026-10-07', 'America/New_York'],
  ]);
});

test('PDF printed pickup and delivery schedules remain visible without normalized appointment timestamps', () => {
  const details = buildLoadDetails({
    driverBrief: { stops: [
      { role: 'pickup', scheduledDate: '10-12-26', timePrinted: '10:00', appointmentPrinted: '10-12-26 10:00 (CONFIRMATION: 123)' },
      { role: 'delivery', scheduledDate: '10-13-26', timePrinted: '23:00' },
    ] },
  });
  assert.deepEqual(details.stops.map(stop => stop.appointment), ['10-12-26 · 10:00', '10-13-26 · 23:00']);
  assert.deepEqual(details.stops.map(stop => [stop.scheduleDate, stop.scheduleTime]), [
    ['10-12-26', '10:00'],
    ['10-13-26', '23:00'],
  ]);
});

test('a printed schedule is a fallback, not a replacement for a normalized appointment', () => {
  const details = buildLoadDetails({
    driverBrief: { stops: [
      { role: 'pickup', appointmentFrom: '2026-10-12T10:00:00-05:00', scheduledDate: '10-12-26', timePrinted: '10:00' },
      { role: 'delivery', appointmentPrinted: 'Tomorrow after 8:00' },
    ] },
  });
  assert.deepEqual(details.stops.map(stop => stop.appointment), ['2026-10-12T10:00:00-05:00', 'Tomorrow after 8:00']);
  assert.equal(details.stops[0].scheduleDate, null);
  assert.equal(details.stops[0].scheduleTime, null);
});


test('latest location uses timestamped latest GPS, never START or online fallback', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const load = { driverId: 'd1', origin: { lat: 44, lng: -80 } };
  const driver = { id: 'd1', isOnline: true, lat: 10, lng: 10,
    lastKnownPosition: { latitude: 41, longitude: -87, capturedAt: '2026-10-14T11:59:30Z' } };
  assert.deepEqual(loadCurrentLocation(load, driver, now), {
    lat: 41, lng: -87, observedAt: now - 30_000, stale: false, accuracyMeters: null,
  });
  assert.equal(loadCurrentLocation(load, { ...driver, isOnline: false }, now).stale, true);
  assert.equal(loadCurrentLocation(load, driver, now + 180_000).stale, true);
  assert.equal(loadCurrentLocation(load, { ...driver, lastKnownPosition: null }, now), null);
  assert.equal(loadCurrentLocation(load, { ...driver, id: 'other' }, now), null);
  for (const capturedAt of ['', 'invalid', '2026-10-14T13:00:00Z']) {
    assert.equal(loadCurrentLocation(load, { ...driver, lastKnownPosition: { ...driver.lastKnownPosition, capturedAt } }, now), null);
  }
  for (const latitude of [null, undefined, '', ' ', 91, Infinity]) {
    assert.equal(loadCurrentLocation(load, { ...driver, lastKnownPosition: { ...driver.lastKnownPosition, latitude } }, now), null);
  }
});

test('pickup route starts at last GPS and follows the first pickup without modifying pay origin', () => {
  const load = { origin: { lat: 44, lng: -80 }, destination: { lat: 45, lng: -81 } };
  const before = JSON.stringify(load);
  const stops = latestPickupRouteStops(load, { lat: 41, lng: -87 });
  assert.equal(stops[0].latitude, 41);
  assert.equal(stops[1].latitude, 44);
  assert.equal(stops[1].role, 'pickup');
  assert.equal(JSON.stringify(load), before);
  assert.deepEqual(latestPickupRouteStops(load, null), []);
});


test('pickup estimates survive GPS-only refresh but invalidate immediately on destination or driver changes', () => {
  const pickup = { latitude: 42, longitude: -80, address: '10 Dock St' };
  const first = pickupEstimateScope('load', 'driver', [{ latitude: 40 }, pickup]);
  const movedGps = pickupEstimateScope('load', 'driver', [{ latitude: 41 }, pickup]);
  const snapshot = { scope: first, route: { data: { distanceMeters: 1200 } }, observedAt: 1000 };
  assert.equal(first, movedGps);
  assert.equal(selectPickupEstimate(movedGps, null, snapshot, true), snapshot);
  const changedPickup = pickupEstimateScope('load', 'driver', [{ latitude: 41 }, { ...pickup, latitude: 43 }]);
  assert.equal(selectPickupEstimate(changedPickup, snapshot, snapshot, true), null);
  const changedAddress = pickupEstimateScope('load', 'driver', [{ latitude: 41 }, { ...pickup, address: '20 Dock St' }]);
  assert.equal(selectPickupEstimate(changedAddress, null, snapshot, true), null);
  assert.equal(selectPickupEstimate(pickupEstimateScope('load', 'other', [{}, pickup]), null, snapshot, true), null);
  assert.equal(selectPickupEstimate(first, snapshot, snapshot, false), null);
  const newer = { scope: first, route: { data: { distanceMeters: 900 } }, observedAt: 2000 };
  assert.equal(selectPickupEstimate(first, newer, snapshot, true), newer);
  const failed = { scope: first, route: { error: true }, observedAt: 3000 };
  assert.equal(selectPickupEstimate(first, failed, snapshot, true), failed);
});


test('saved route retains stop reference numbers and instructions without an AI field snapshot', () => {
  const details = buildLoadDetails({ stops: [
    { role: 'pickup', address: '1 Main St', referenceNumber: 'PU-123', appointmentReference: 'AP-456', orderReferences: 'ORD-789', instructions: 'Use the east gate' },
    { role: 'delivery', address: '2 Main St', note: 'Call before arrival' },
  ] });
  assert.equal(details.stops[0].reference, 'PU-123');
  assert.equal(details.stops[0].appointmentReference, 'AP-456');
  assert.equal(details.stops[0].orderReferences, 'ORD-789');
  assert.equal(details.stops[0].note, 'Use the east gate');
  assert.equal(details.stops[1].note, 'Call before arrival');
});


test('road summary combines the displayed route with the latest-position pickup estimate', () => {
  const route = miles => ({ data: { distanceMeters: miles * 1609.344 } });
  const summary = savedLoadRoadSummary(2400, route(900), route(100), true);
  assert.equal(summary.loadedMiles, 900);
  assert.equal(summary.deadheadMiles, 100);
  assert.equal(summary.totalMiles, 1000);
  assert.equal(summary.ratePerMile, 2.4);
});

test('road summary never invents deadhead, total miles, or total RPM when GPS is absent', () => {
  const route = { data: { distanceMeters: 160934.4 } };
  const summary = savedLoadRoadSummary(500, route, route, false);
  assert.equal(summary.loadedMiles, 100);
  assert.equal(summary.deadheadMiles, null);
  assert.equal(summary.totalMiles, null);
  assert.equal(summary.ratePerMile, null);
});

test('road summary rejects failed and invalid distances and missing rates', () => {
  const valid = { data: { distanceMeters: 160934.4 } };
  for (const failed of [null, { error: true, data: valid.data }, { data: { ...valid.data, routingFailed: true } }, { data: { distanceMeters: -1 } }, { data: { distanceMeters: NaN } }]) {
    assert.equal(savedLoadRoadSummary(500, failed, valid, true).totalMiles, null);
    assert.equal(savedLoadRoadSummary(500, valid, failed, true).ratePerMile, null);
  }
  assert.equal(savedLoadRoadSummary(null, valid, valid, true).ratePerMile, null);
  assert.equal(savedLoadRoadSummary(0, valid, valid, true).ratePerMile, 0);
  const zero = { data: { distanceMeters: 0 } };
  assert.equal(savedLoadRoadSummary(500, zero, zero, true).totalMiles, 0);
  assert.equal(savedLoadRoadSummary(500, zero, zero, true).ratePerMile, null);
});


test('saved contact phone matches stable stop ID rather than repeated role/sequence', () => {
  const stops = [{ stopId: 'p2', role: 'pickup' }];
  assert.equal(savedStopContactPhone(stops, 0, [
    { stopId: 'p1', role: 'pickup', sequence: 1, status: 'found', phone: 'wrong' },
    { stopId: 'p2', role: 'pickup', sequence: 2, status: 'found', phone: 'correct' },
  ]), 'correct');
});

test('ID-less contact phone requires full ordered address identity and route count', () => {
  const stops = [{ role: 'pickup', address: '1 Main St', city: 'Dallas', state: 'TX', postalCode: '75001' },
    { role: 'pickup', address: '2 Main St', city: 'Dallas', state: 'TX', postalCode: '75001' }];
  const contacts = stops.map((stop, index) => ({ ...stop, sequence: index + 1, status: 'found', phone: `phone-${index}` }));
  assert.equal(savedStopContactPhone(stops, 1, contacts), 'phone-1');
  assert.equal(savedStopContactPhone(stops, 0, contacts.slice(0, 1)), null);
  assert.equal(savedStopContactPhone(stops, 0, contacts.map(contact => ({ ...contact, address: 'another address' }))), null);
  assert.equal(savedStopContactPhone(stops, 0, contacts.map(contact => ({ ...contact, sequence: 3 - contact.sequence }))), null);
  assert.equal(savedStopContactPhone(stops, 0, contacts.map(contact => ({ ...contact, city: 'Austin' }))), null);
});
