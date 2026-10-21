import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalJobs, arrivalLane, arrivalMatches, arrivalPhone, arrivalState } from './arrivalBoardModel.js';

const now = Date.parse('2026-10-20T12:00:00Z');
const driver = { id: 'd1', name: 'Alex Petrov', isOnline: true,
  lastKnownPosition: { latitude: 41, longitude: -81, capturedAt: new Date(now).toISOString() } };
const load = { id: 'l1', driverId: 'd1', loadNumber: '#17781', status: 'ASSIGNED', databaseStatus: 'assigned',
  origin: { city: 'Orwell', state: 'OH', lat: 41, lng: -81, appointmentAt: '2026-10-20T15:00:00Z' },
  destination: { city: 'Independence', state: 'KY', lat: 39, lng: -84, appointmentAt: '2026-10-21T10:00:00Z' } };
const job = () => arrivalJobs([driver], [load], now)[0];
const estimate = (item, minutes) => ({ scope: item.scope, observedAt: now, eta: now + minutes * 60_000 });

test('only active scoped loads appear; idle drivers remain visible', () => {
  const jobs = arrivalJobs([driver, { id: 'd2', name: 'Idle' }], [load, { ...load, id: 'foreign', driverId: 'other' },
    { ...load, id: 'trash', trashedAt: new Date(now).toISOString() }, { ...load, id: 'done', databaseStatus: 'delivered' }], now);
  assert.deepEqual(jobs.map(item => item.id), ['l1', 'idle:d2']);
  assert.equal(arrivalState(jobs[1], null, now).status, 'idle');
});
test('pickup and delivery select their own stops and invalidate prior estimates', () => {
  const pickup = job();
  const delivery = arrivalJobs([driver], [{ ...load, status: 'ON_ROAD' }], now)[0];
  assert.equal(pickup.target.city, 'Orwell');
  assert.equal(delivery.target.city, 'Independence');
  assert.equal(arrivalState(delivery, estimate(pickup, 60), now).eta, null);
});
test('fresh estimates distinguish on-time, tight margins and lateness', () => {
  const item = job();
  assert.equal(arrivalState(item, estimate(item, 120), now).status, 'onTime');
  assert.equal(arrivalState(item, estimate(item, 160), now).status, 'risk');
  assert.deepEqual(arrivalState(item, estimate(item, 190), now), { status: 'late', eta: now + 190 * 60_000, issue: 'late', minutes: 10 });
});
test('an appointment window uses its closing time rather than falsely flagging lateness after opening', () => {
  const item = arrivalJobs([driver], [{ ...load, origin: { ...load.origin, appointmentTo: '2026-10-20T17:00:00Z' } }], now)[0];
  assert.equal(arrivalState(item, estimate(item, 190), now).status, 'onTime');
});
test('missing, stale, future and offline GPS never give an on-time assurance', () => {
  for (const position of [null, { ...driver.lastKnownPosition, capturedAt: new Date(now - 180_000).toISOString() },
    { ...driver.lastKnownPosition, capturedAt: new Date(now + 120_000).toISOString() }]) {
    const item = arrivalJobs([{ ...driver, lastKnownPosition: position }], [load], now)[0];
    assert.equal(arrivalState(item, estimate(item, 60), now).status, 'noGps');
  }
  const offline = arrivalJobs([{ ...driver, isOnline: false }], [load], now)[0];
  assert.equal(arrivalState(offline, estimate(offline, 60), now).eta, null);
});
test('expired predictions and local-only appointment dates are not treated as confirmed', () => {
  const item = job();
  assert.equal(arrivalState(item, { ...estimate(item, 60), observedAt: now - 121_000 }, now).eta, null);
  assert.equal(arrivalState(item, estimate(item, -1), now).eta, null);
  const ambiguous = arrivalJobs([driver], [{ ...load, origin: { ...load.origin, appointmentAt: '2026-10-20T15:00:00' } }], now)[0];
  assert.equal(arrivalState(ambiguous, estimate(ambiguous, 60), now).issue, 'noAppointment');
});
test('multiple stops and stacked assignments require explicit next-stop confirmation', () => {
  const multi = arrivalJobs([driver], [{ ...load, stops: [{ role: 'pickup' }, { role: 'pickup' }, { role: 'delivery' }] }], now)[0];
  assert.equal(multi.target, null);
  assert.equal(arrivalState(multi, estimate(multi, 60), now).issue, 'multipleStops');
  const stacked = arrivalJobs([driver], [load, { ...load, id: 'l2' }], now);
  assert.equal(stacked.length, 2);
  assert.ok(stacked.every(item => item.ambiguous && item.target === null));
});
test('arrival lanes handle exact boundaries and unknown ETA without fabricated grouping', () => {
  assert.equal(arrivalLane(now + 2 * 3_600_000, now), 'soon');
  assert.equal(arrivalLane(now + 2 * 3_600_000 + 1, now), 'next');
  assert.equal(arrivalLane(now + 4 * 3_600_000, now), 'next');
  assert.equal(arrivalLane(now + 24 * 3_600_000, now), 'later');
  assert.equal(arrivalLane(null, now), 'unknown');
});
test('search spans driver, load and route; telephone links reject non-phone schemes', () => {
  assert.equal(arrivalMatches(job(), 'alex 17781 orwell'), true);
  assert.equal(arrivalMatches(job(), 'missing'), false);
  assert.equal(arrivalPhone('+1 (440) 437-5144'), 'tel:+14404375144');
  assert.equal(arrivalPhone('javascript:alert(1)'), null);
});
