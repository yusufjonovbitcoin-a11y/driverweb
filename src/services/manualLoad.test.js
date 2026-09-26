import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManualLoad } from './manualLoad.js';
const form = { loadNumber: 'MANUAL-123', broker: ' Dispatcher broker ', equipment: 'Dry van', originCity: 'New York', originState: 'NY', destinationCity: 'Boston', destinationState: 'MA', rate: '0', distanceMiles: '0', weightLbs: '' };
const normalize = (overrides = {}, ids = ['driver-a']) => normalizeManualLoad({ ...form, ...overrides }, ids, ['driver-a', 'driver-b']);
test('manual data preserves explicit zero and never invents missing logistics details', () => {
  const load = normalize();
  assert.equal(load.rate, 0);
  assert.equal(load.broker, 'Dispatcher broker');
  assert.equal(load.distanceMiles, 0);
  assert.equal(load.weightLbs, null);
  assert.equal(load.ratePerMile, null);
  assert.equal(load.origin.address, null);
  assert.equal(load.origin.lat, null);
  assert.equal(load.destination.date, null);
  assert.equal(load.brokerPhone, null);
  assert.equal(load.documents.rateCon, null);
});
test('required values cannot silently fall back to sample data', () => {
  for (const field of ['loadNumber', 'broker', 'equipment', 'originCity', 'destinationCity', 'originState', 'destinationState', 'distanceMiles', 'rate']) {
    assert.throws(() => normalize({ [field]: ' ' }));
  }
});
test('rejects invalid financial and numeric input', () => {
  for (const field of ['rate', 'distanceMiles', 'weightLbs']) {
    for (const value of ['NaN', 'Infinity', '-2', NaN, Infinity, {}, true]) assert.throws(() => normalize({ [field]: value }));
  }
});
test('known distances calculate rate per mile; explicit zero distance stays zero', () => {
  assert.equal(normalize({ rate: '250.50', distanceMiles: '100' }).ratePerMile, 2.505);
  assert.equal(normalize({ distanceMiles: '0' }).distanceMiles, 0);
  assert.equal(normalize({ distanceMiles: '0' }).ratePerMile, null);
});
test('load identifier is stable across validation attempts and target ids are validated', () => {
  assert.equal(normalize().loadNumber, normalize().loadNumber);
  assert.deepEqual(normalize({}, ['driver-a', 'driver-a', 'unknown']).targetDriverIds, ['driver-a']);
  assert.throws(() => normalize({}, ['unknown']));
  assert.throws(() => normalize({}, []));
});

test('optional weight matches positive-integer database constraint', () => {
  assert.equal(normalize({ weightLbs: '' }).weightLbs, null);
  assert.equal(normalize({ weightLbs: '41000' }).weightLbs, 41000);
  for (const value of ['0', '0.5', '123.4', '-1']) assert.throws(() => normalize({ weightLbs: value }));
});
