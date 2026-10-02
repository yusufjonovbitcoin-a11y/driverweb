import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportedLoad, canAssignImportedLoad, importedMapState, stopAddress } from './importedLoadModel.js';

test('staff snapshot is authoritative and preserves date-only stops without inventing time', () => {
  const fields = Object.entries({ loadNumber: '25008654', 'pickup.scheduledDate': 'Thu 10/01/2026', 'delivery.note': 'Give notice.',
    bolNumber: '25008654', 'requirements.0': 'First instruction', 'requirements.1': 'Later instruction',
    specialInstructions: 'Short note', 'broker.email': 'broker@example.com', cargoModel: 'Generator' }).map(([key, value]) => ({ key, value, page: 1, quote: String(value) }));
  const result = buildImportedLoad({ documentDetails: { version: 2, fields }, driverBrief: { fields: [{ key: 'loadNumber', value: 'STALE' }] }, brokerEmail: 'old@example.com' });
  assert.equal(result.number, '25008654');
  assert.equal(result.extendedDocument, true);
  assert.equal(result.pickup.scheduledDate, 'Thu 10/01/2026');
  assert.equal(result.pickup.appointment, null);
  assert.equal(result.pickup.timePrinted, null);
  assert.equal(result.bolNumber, '25008654');
  assert.equal(result.delivery.reference, null);
  assert.equal(result.equipment, null);
  assert.equal(result.brokerEmail, 'broker@example.com');
  assert.equal(result.requirements.length, 2);
  assert.equal(result.instructions, 'Short note');
});

test('extended snapshot never replaces verified money and miles with stale load values', () => {
  const load = { rate: 9999, distanceMiles: 9999, documentDetails: { version: 2, fields: [
    { key: 'brokerRate', value: 1000 }, { key: 'loadedMiles', value: 0 },
  ] } };
  assert.equal(buildImportedLoad(load).rate, 1000);
  assert.equal(buildImportedLoad(load).distance, 0);
  assert.equal(buildImportedLoad(load).rpm, null);
  load.documentDetails.fields = [];
  assert.equal(buildImportedLoad(load).rate, null);
  assert.equal(buildImportedLoad(load).distance, null);
});

test('unrelated extraction warnings never disable the route preview', () => {
  assert.equal(importedMapState({ blockingFields: ['caseCount', 'requirements.1', 'requirements'] }).routeEnabled, true);
  assert.equal(importedMapState({ blockingFields: ['pickup.addressLine'] }).routeEnabled, false);
  assert.equal(importedMapState({ blockingFields: ['delivery.city'] }).routeEnabled, false);
});
test('only the selected online driver with valid GPS gets a current-location marker', () => {
  const details = { blockingFields: [] };
  assert.deepEqual(importedMapState(details, { isOnline: true, lat: 0, lng: 0 }).livePosition, { lat: 0, lng: 0 });
  assert.equal(importedMapState(details, { isOnline: false, lat: 32, lng: -100 }).livePosition, null);
  assert.equal(importedMapState(details, { isOnline: true, lat: null, lng: null }).livePosition, null);
  assert.equal(importedMapState(details, { isOnline: true, lat: 200, lng: 0 }).livePosition, null);
  assert.equal(importedMapState(details, undefined).livePosition, null);
});

test('import page uses verified fields, not stale fallback facts or inferred appointments', () => {
  const load = buildImportedLoad({
    loadNumber: 'STALE', origin: { address: 'Stale address', date: '2026-10-02' },
    temperature: 99, driverBrief: { fields: [
      { key: 'loadNumber', value: 'DOC-10' },
      { key: 'pickup.appointmentPrinted', value: 'Oct 2 / FCFS, 8–16 local' },
      { key: 'temperatureFahrenheit', value: -10 },
      { key: 'palletCount', value: 0 }, { key: 'isHazmat', value: false },
    ] },
  });
  assert.equal(load.number, 'DOC-10');
  assert.equal(load.pickup.address, null);
  assert.equal(load.pickup.appointment, 'Oct 2 / FCFS, 8–16 local');
  assert.equal(load.delivery.appointment, null);
  assert.equal(load.temperature, -10);
  assert.equal(load.pallets, 0);
  assert.equal(load.hazmat, false);
});
test('missing financial values stay unknown and RPM requires positive documented distance', () => {
  assert.equal(buildImportedLoad({ rate: 0, rateKnown: false }).rate, null);
  assert.equal(buildImportedLoad({ rate: 700, distanceMiles: 0 }).rpm, null);
  assert.equal(buildImportedLoad({ rate: 700, distanceMiles: 350 }).rpm, 2);
  assert.equal(buildImportedLoad({ distanceMiles: 0, driverBrief: { fields: [], unknownFields: ['loadedMiles'] } }).distance, null);
  assert.equal(stopAddress({ address: '100 First Ave', city: 'Phoenix', state: 'AZ' }), '100 First Ave, Phoenix, AZ');
});
test('import assignment requires a real driver, reviewed data, open status and no blockers', () => {
  const load = { id: 'load', lifecycleStatus: 'review', review: { required: true, blockingFields: [] } };
  const drivers = [{ id: 'driver' }];
  assert.equal(canAssignImportedLoad(load, 'driver', drivers, false), false);
  assert.equal(canAssignImportedLoad(load, 'driver', drivers, true), true);
  assert.equal(canAssignImportedLoad(load, 'missing', drivers, true), false);
  assert.equal(canAssignImportedLoad(load, 'driver', drivers, true, true), false);
  assert.equal(canAssignImportedLoad({ ...load, review: { blockingFields: ['pickup.addressLine'] } }, 'driver', drivers, true), false);
  assert.equal(canAssignImportedLoad({ ...load, lifecycleStatus: 'completed' }, 'driver', drivers, true), false);
  assert.equal(canAssignImportedLoad({ ...load, importError: 'failed' }, 'driver', drivers, true), false);
});
test('legacy malformed phones never appear as dialable stop contacts', () => {
  const result = buildImportedLoad({ driverBrief: { fields: [
    { key: 'pickup.contactPhone', value: '/NCFISPHO1023BUFFAMISSOURICTX77489CONTACT' },
    { key: 'delivery.contactPhone', value: '+1 866-471-3583' },
    { key: 'weightPrinted', value: '19780.00' },
  ] } });
  assert.equal(result.pickup.phone, null);
  assert.equal(result.delivery.phone, '+1 866-471-3583');
  assert.equal(result.weightPrinted, '19780.00');
});
