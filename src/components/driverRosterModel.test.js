import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeLoadsForDriver,
  lastSeenKind,
  partitionDriverLoads,
  rosterAppointment,
  rosterStopAddress,
} from './driverRosterModel.js';

test('driver roster keeps every current load in display order', () => {
  const loads = [
    { id: '1', driverId: 'driver-a', status: 'ASSIGNED', loadNumber: '#100' },
    { id: '2', driverId: 'driver-b', status: 'IN_TRANSIT', loadNumber: '#200' },
    { id: '3', driverId: 'driver-a', status: 'IN_TRANSIT', loadNumber: '#300' },
    { id: '4', driverId: 'driver-a', status: 'COMPLETED', loadNumber: '#400' },
    { id: '5', driverId: 'driver-a', status: 'COMPLETED', databaseStatus: 'cancelled', loadNumber: '#500' },
    { id: '6', driverId: 'driver-a', status: 'DELIVERED', databaseStatus: 'dispute', loadNumber: '#600' },
  ];

  assert.deepEqual(
    activeLoadsForDriver(loads, 'driver-a').map((load) => load.loadNumber),
    ['#100', '#300'],
  );
});

test('cancelled and disputed loads never appear as completed driver trips', () => {
  const loads = [
    { id: 'active', status: 'ON_ROAD', databaseStatus: 'in_progress' },
    { id: 'finished', status: 'COMPLETED', databaseStatus: 'completed' },
    { id: 'cancelled', status: 'COMPLETED', databaseStatus: 'cancelled' },
    { id: 'disputed', status: 'DELIVERED', databaseStatus: 'dispute' },
  ];
  const result = partitionDriverLoads(loads);
  assert.deepEqual(result.workflow.map((load) => load.id), ['active', 'finished']);
  assert.deepEqual(result.exceptions.map((load) => load.id), ['cancelled', 'disputed']);
});

test('last activity uses time, yesterday, then date at the requested thresholds', () => {
  const now = new Date('2026-09-30T21:00:00Z').getTime();
  assert.equal(lastSeenKind('2026-09-30T20:00:00Z', now), 'time');
  assert.equal(lastSeenKind('2026-09-29T20:59:59Z', now), 'yesterday');
  assert.equal(lastSeenKind('2026-09-28T21:00:00Z', now), 'date');
  assert.equal(lastSeenKind(null, now), 'never');
  assert.equal(lastSeenKind('not-a-date', now), 'never');
});

test('driver roster resolves stop address and appointment without inventing data', () => {
  assert.equal(
    rosterStopAddress({ address: '400 Wabash Rd', city: 'Ephrata', state: 'PA' }),
    '400 Wabash Rd',
  );
  assert.equal(
    rosterStopAddress({ city: 'Mechanicsburg', state: 'PA', postalCode: '17055' }),
    'Mechanicsburg, PA, 17055',
  );
  assert.equal(rosterStopAddress({}), null);
  assert.equal(
    rosterAppointment({ appointmentAt: '2026-10-01T08:30:00Z', date: 'ignored' }),
    '2026-10-01T08:30:00Z',
  );
  assert.equal(rosterAppointment({}), null);
});
