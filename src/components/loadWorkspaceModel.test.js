import test from 'node:test';
import assert from 'node:assert/strict';
import { filterWorkspaceLoads, summarizeWorkspaceLoads } from './loadWorkspaceModel.js';

const driversById = new Map([
  ['driver-a', { name: 'Saiddjafar Akhmedov', driverNumber: '#9183', truck: 'Volvo 760', trailer: 'Reefer 53' }],
  ['driver-b', { name: 'Shaxriyor Rashitov', driverNumber: '#C5C9', truck: 'Freightliner 123' }],
]);
const first = Object.freeze({
  id: 'first', loadNumber: '#2536705', driverId: 'driver-a', status: 'ASSIGNED', broker: 'FitzMark',
  origin: Object.freeze({ city: 'Hilton', state: 'NY', address: '36 Draffin Road' }),
  destination: Object.freeze({ city: 'Wind Gap', state: 'PA', address: '650 Male Road' }),
});
const second = Object.freeze({
  id: 'second', loadNumber: '3098315', driverId: 'driver-b', status: 'COMPLETED',
  origin: Object.freeze({ city: 'Phoenix', state: 'AZ' }),
  destination: Object.freeze({ city: 'City of Industry', state: 'CA' }),
});
const offered = Object.freeze({
  id: 'offer', loadNumber: '38594033', status: 'UNASSIGNED', targetDriverIds: Object.freeze(['driver-a']),
});
const loads = Object.freeze([first, second, offered]);

test('search matches every token across load number, endpoints, addresses and broker', () => {
  for (const query of ['#2536705', '253 6705', 'HILTON ny', '36 draffin FITZMARK', 'Wind Gap 650 MALE pa']) {
    assert.deepEqual(filterWorkspaceLoads(loads, { query }), [first], query);
  }
  assert.deepEqual(filterWorkspaceLoads(loads, { query: 'Hilton Arizona' }), []);
  assert.deepEqual(filterWorkspaceLoads(loads, { query: 'Phoenix Industry' }), [second]);
});

test('search includes only the assigned driver name, number, truck and trailer', () => {
  for (const query of ['akhmedov', '#9183', 'VOLVO 760', 'reefer 53', 'Saiddjafar Hilton']) {
    assert.deepEqual(filterWorkspaceLoads(loads, { query, driversById }), [first], query);
  }
  assert.deepEqual(filterWorkspaceLoads(loads, { query: 'C5C9 freightliner', driversById }), [second]);
  assert.deepEqual(filterWorkspaceLoads([offered], { query: 'Saiddjafar', driversById }), []);
});

test('driver filters use exact assigned IDs and never offered recipient IDs', () => {
  assert.deepEqual(filterWorkspaceLoads(loads, { driverId: 'driver-a' }), [first]);
  assert.deepEqual(filterWorkspaceLoads(loads, { driverId: 'driver-b' }), [second]);
  assert.deepEqual(filterWorkspaceLoads(loads, { driverId: 'driver' }), []);
  assert.deepEqual(filterWorkspaceLoads(loads, { driverId: 'UNASSIGNED' }), [offered]);
});

test('unassigned driver filtering checks assignment independently of workflow status', () => {
  const acceptedWithoutDriver = { status: 'ASSIGNED' };
  const offeredWithDriver = { status: 'UNASSIGNED', driverId: 'driver-a' };
  assert.deepEqual(filterWorkspaceLoads([acceptedWithoutDriver, offeredWithDriver], { driverId: 'UNASSIGNED' }), [acceptedWithoutDriver]);
});

test('driver scope and text query are combined, and no-match searches stay empty', () => {
  assert.deepEqual(filterWorkspaceLoads(loads, { driverId: 'driver-a', query: 'reefer', driversById }), [first]);
  assert.deepEqual(filterWorkspaceLoads(loads, { driverId: 'driver-b', query: 'reefer', driversById }), []);
});

test('blank queries preserve load order without mutating inputs', () => {
  assert.deepEqual(filterWorkspaceLoads(loads), loads);
  assert.deepEqual(filterWorkspaceLoads(loads, { query: '  ' }), loads);
  assert.notEqual(filterWorkspaceLoads(loads), loads);
  assert.deepEqual(loads.map(load => load.id), ['first', 'second', 'offer']);
});

test('missing loads, endpoints and driver records are handled without invented matches', () => {
  assert.deepEqual(filterWorkspaceLoads(undefined), []);
  assert.deepEqual(filterWorkspaceLoads(null), []);
  assert.deepEqual(filterWorkspaceLoads([null, {}], { query: 'undefined' }), []);
  assert.deepEqual(filterWorkspaceLoads([first], { query: 'Akhmedov', driversById: null }), []);
  assert.deepEqual(filterWorkspaceLoads([first], { query: 'Hilton', driversById: null }), [first]);
  assert.deepEqual(filterWorkspaceLoads([{ origin: { region: 'CT', addressLine: '12 Café Street' } }], { query: 'cafe CT' }).length, 1);
});

test('summary counts statuses and distinct assigned drivers without counting offer recipients', () => {
  assert.deepEqual(summarizeWorkspaceLoads([...loads, { status: 'ON_ROAD', driverId: 'driver-a' }]), {
    total: 4, active: 2, unassigned: 1, completed: 1, driverCount: 2,
  });
  assert.deepEqual(summarizeWorkspaceLoads([offered]), {
    total: 1, active: 0, unassigned: 1, completed: 0, driverCount: 0,
  });
});

test('summary preserves existing status semantics, including delivered and cancelled records', () => {
  assert.deepEqual(summarizeWorkspaceLoads([
    { status: 'DELIVERED', driverId: 'driver-a' },
    { status: 'COMPLETED', databaseStatus: 'cancelled', driverId: 'driver-a' },
    { status: 'CANCELLED', driverId: 'driver-b' },
  ]), { total: 3, active: 2, unassigned: 0, completed: 1, driverCount: 2 });
  assert.deepEqual(summarizeWorkspaceLoads(null), {
    total: 0, active: 0, unassigned: 0, completed: 0, driverCount: 0,
  });
});
