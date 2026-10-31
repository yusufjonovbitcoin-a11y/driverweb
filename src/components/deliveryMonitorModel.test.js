import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDeliveryRows, deliveryMonitorGroup, deliveryMonitorJobs, deliveryMonitorProblemCount, deliveryMonitorState } from './deliveryMonitorModel.js';

const now = Date.parse('2026-10-22T14:00:00Z');
const driver = { id: 'd1', name: 'Amin', isOnline: true, lastKnownPosition: { latitude: 41, longitude: -81, capturedAt: new Date(now).toISOString() } };
const load = { id: 'l1', driverId: 'd1', status: 'ON_ROAD', databaseStatus: 'on_road',
  origin: { city: 'Buffalo', state: 'NY', lat: 41, lng: -81, appointmentAt: '2026-10-22T15:00:00Z' },
  destination: { city: 'Wind Gap', state: 'PA', lat: 40, lng: -75, appointmentAt: '2026-10-22T16:00:00Z' } };
const estimate = (job, minutes) => ({ scope: job.scope, observedAt: now, eta: now + minutes * 60_000 });

test('pickup travel never appears as delivery ETA', () => {
  const job = deliveryMonitorJobs([driver], [{ ...load, status: 'ASSIGNED' }], now)[0];
  assert.equal(job.role, 'delivery');
  assert.equal(job.target, null);
  assert.equal(job.scheduledAt, Date.parse(load.destination.appointmentAt));
  assert.equal(deliveryMonitorState(job, estimate(job, 30), now).eta, null);
  assert.equal(deliveryMonitorState(job, estimate(job, 30), now).issue, 'awaitingPickup');
});

test('late, tight-window and on-time classification use delivery appointment', () => {
  const job = deliveryMonitorJobs([driver], [load], now)[0];
  assert.equal(deliveryMonitorState(job, estimate(job, 90), now).status, 'onTime');
  assert.equal(deliveryMonitorState(job, estimate(job, 105), now).status, 'risk');
  assert.equal(deliveryMonitorState(job, estimate(job, 190), now).minutes, 70);
});

test('stale GPS and offsetless appointments cannot provide an on-time assurance', () => {
  const staleDriver = { ...driver, lastKnownPosition: { ...driver.lastKnownPosition, capturedAt: new Date(now - 300_000).toISOString() } };
  const job = deliveryMonitorJobs([staleDriver], [load], now)[0];
  assert.equal(deliveryMonitorState(job, estimate(job, 60), now).status, 'noGps');
  const noZone = deliveryMonitorJobs([driver], [{ ...load, destination: { ...load.destination, appointmentAt: '2026-10-22T16:00:00' } }], now)[0];
  assert.equal(noZone.scheduledAt, null);
  assert.equal(deliveryMonitorState(noZone, estimate(noZone, 60), now).status, 'unknown');
});

test('multiple active assignments remain unknown and idle is separate', () => {
  const jobs = deliveryMonitorJobs([driver, { id: 'idle', name: 'Kevin' }], [load, { ...load, id: 'l2' }], now);
  assert.equal(jobs.length, 3);
  assert.equal(deliveryMonitorState(jobs[0], estimate(jobs[0], 60), now).eta, null);
  assert.equal(deliveryMonitorGroup(deliveryMonitorState(jobs[2], null, now)), 'idle');
  assert.equal(deliveryMonitorGroup({ status: 'noGps' }), 'attention');
});

test('priority sorting shows late then risk, GPS/unknown, on time, idle', () => {
  const statuses = ['idle', 'onTime', 'unknown', 'risk', 'late', 'noGps'];
  const rows = statuses.map(status => ({ job: { driver }, state: { status } }));
  assert.deepEqual(rows.sort(compareDeliveryRows).map(row => row.state.status), ['late', 'risk', 'noGps', 'unknown', 'onTime', 'idle']);
});

test('warning count excludes idle and on-time rows and clears after problems resolve', () => {
  const row = status => ({ job: { load: status === 'idle' ? null : load }, state: { status } });
  assert.equal(deliveryMonitorProblemCount(['late', 'risk', 'noGps', 'unknown', 'onTime', 'idle'].map(row)), 4);
  assert.equal(deliveryMonitorProblemCount(['onTime', 'idle'].map(row)), 0);
  assert.equal(deliveryMonitorProblemCount([]), 0);
});
