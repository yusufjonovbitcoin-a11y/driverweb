import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportedLoad, canAssignImportedLoad, importedMapState, importedRatePerMile, importedTripRatePerMile, stopAddress, stopScheduleParts } from './importedLoadModel.js';

test('stop schedule prints the same appointment window only once', () => {
  assert.deepEqual(stopScheduleParts({ scheduledDate: '09/28/2026', timePrinted: '07:30 - 14:00',
    appointment: ' 07:30  -  14:00 ', readyDate: null, hours: null }),
  [['date', '09/28/2026'], ['time', '07:30 - 14:00']]);
  assert.deepEqual(stopScheduleParts({ timePrinted: '07:30 - 14:00', appointment: 'FCFS 07:30 - 14:00' }),
    [['appointment', 'FCFS 07:30 - 14:00']]);
});

test('ISO date plus time does not repeat the same named-date appointment from the screenshot', () => {
  assert.deepEqual(stopScheduleParts({ scheduledDate: '2026-10-01', timePrinted: '08:00 - 15:30',
    appointment: 'OCT 01, 2026 08:00 - 15:30' }),
  [['date', '2026-10-01'], ['time', '08:00 - 15:30']]);
  assert.deepEqual(stopScheduleParts({ scheduledDate: '2026-10-02', timePrinted: '09:01 - Appointment',
    appointment: 'OCT 02, 2026 09:01 - Appointment' }),
  [['date', '2026-10-02'], ['time', '09:01 - Appointment']]);
});

test('comparison tolerates explicit numeric date, dash, hour and AM/PM formatting without altering displayed facts', () => {
  assert.deepEqual(stopScheduleParts({ scheduledDate: '10/1/2026', timePrinted: '8:00 – 15:30',
    appointment: 'October 01, 2026 8:00am - 3:30pm' }),
  [['date', '10/1/2026'], ['time', '8:00 – 15:30']]);
  assert.deepEqual(stopScheduleParts({ scheduledDate: '9/30/26', timePrinted: '09:00', appointment: '9/30/26 09:00' }),
    [['date', '9/30/26'], ['time', '09:00']]);
});

test('richer appointment instructions keep FCFS once, with no duplicated date or window', () => {
  assert.deepEqual(stopScheduleParts({ scheduledDate: '2026-10-01', timePrinted: '08:00 - 15:30',
    appointment: 'OCT 01, 2026 FCFS 08:00 - 15:30' }),
  [['appointment', 'OCT 01, 2026 FCFS 08:00 - 15:30']]);
  assert.deepEqual(stopScheduleParts({ scheduledDate: '2026-10-01', timePrinted: '08:00 - 15:30',
    appointment: 'FCFS 08:00 - 15:30' }),
  [['date', '2026-10-01'], ['appointment', 'FCFS 08:00 - 15:30']]);
});

test('genuinely different dates, windows and timezones are not hidden as duplicates', () => {
  const stop = { scheduledDate: '2026-10-01', timePrinted: '08:00 - 15:30', appointment: 'OCT 02, 2026 08:00 - 15:30' };
  assert.deepEqual(stopScheduleParts(stop), [['date', stop.scheduledDate], ['time', stop.timePrinted], ['appointment', stop.appointment]]);
  assert.deepEqual(stopScheduleParts({ timePrinted: '08:00 - 15:30', appointment: '09:00 - 16:00' }),
    [['time', '08:00 - 15:30'], ['appointment', '09:00 - 16:00']]);
  assert.deepEqual(stopScheduleParts({ timePrinted: '08:00 EST', appointment: '08:00 CST' }),
    [['time', '08:00 EST'], ['appointment', '08:00 CST']]);
});

test('readiness and opening hours are separate facts; partial dates do not acquire a guessed century', () => {
  assert.deepEqual(stopScheduleParts({ scheduledDate: '2026-10-01', timePrinted: '08:00',
    readyDate: '2026-10-01', hours: '08:00 - 17:00', appointment: 'Oct 1, 2026 08:00' }),
  [['date', '2026-10-01'], ['time', '08:00'], ['ready', '2026-10-01'], ['hours', '08:00 - 17:00']]);
  const partial = { scheduledDate: '10/1/26', timePrinted: '08:00', appointment: '10/1/2026 08:00' };
  assert.equal(stopScheduleParts(partial).length, 3);
  assert.deepEqual(stopScheduleParts({}), []);
  assert.deepEqual(stopScheduleParts({ appointment: 'Call ahead' }), [['appointment', 'Call ahead']]);
});

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
  assert.equal(importedMapState({ blockingFields: ['stops.1.addressLine'] }).routeEnabled, false);
});
test('preview keeps every verified stop without borrowing missing facts from raw extraction', () => {
  const documentDetails = { version: 3,
    stops: [{ role: 'pickup', addressLine: 'stale A' }, { role: 'delivery', addressLine: 'stale B' }, { role: 'delivery', addressLine: 'stale C' }],
    fields: [
      { key: 'stops.0.addressLine', value: '1 First St' }, { key: 'stops.0.city', value: 'Phoenix' },
      { key: 'stops.1.addressLine', value: '2 Second St' }, { key: 'stops.1.city', value: 'Dallas' },
      { key: 'stops.2.addressLine', value: '3 Third St' }, { key: 'stops.2.city', value: 'Austin' },
      { key: 'stops.2.referenceNumber', value: 'DEL-9' },
    ] };
  const result = buildImportedLoad({ documentDetails });
  assert.deepEqual(result.stops.map(stop => stop.address), ['1 First St', '2 Second St', '3 Third St']);
  assert.deepEqual(result.stops.map(stop => stop.role), ['pickup', 'delivery', 'delivery']);
  assert.equal(result.stops[1].reference, null);
  assert.equal(result.delivery.reference, 'DEL-9');
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
test('a separate appointment code is not part of the stop street address', () => {
  assert.equal(stopAddress({ address: '1222MS925 488 PARRIOTT PLACE', appointmentReference: '1222MS925',
    city: 'CITY OF INDUSTRY', state: 'CA', postalCode: '91745' }),
  '488 PARRIOTT PLACE, CITY OF INDUSTRY, CA, 91745');
  assert.equal(stopAddress({ address: '488 PARRIOTT PLACE', appointmentReference: '1222MS925' }), '488 PARRIOTT PLACE');
  assert.equal(stopAddress({ address: '1222MS925 Warehouse Road', appointmentReference: '1222MS925' }),
    '1222MS925 Warehouse Road');
});
test('route miles supply a clearly separate rate per mile only when document miles are absent', () => {
  assert.deepEqual(importedRatePerMile({ rate: 5500, distance: null }, { loadedMiles: 1100 }), { value: 5, source: 'route' });
  assert.deepEqual(importedRatePerMile({ rate: 5500, distance: 1000 }, { loadedMiles: 1100 }), { value: 5.5, source: 'document' });
  assert.deepEqual(importedRatePerMile({ rate: 5500, distance: 0 }, { loadedMiles: 1100 }), { value: null, source: 'document' });
  assert.deepEqual(importedRatePerMile({ rate: null, distance: null }, { loadedMiles: 1100 }), { value: null, source: 'document' });
  assert.deepEqual(importedRatePerMile({ rate: 5500, distance: null }, { loadedMiles: 0 }), { value: null, source: 'route' });
});
test('trip rate falls back to pickup-to-delivery miles when driver miles are unavailable', () => {
  assert.deepEqual(importedTripRatePerMile({ rate: 1000 }, { loadedMiles: 2405.69 }, { totalMiles: null }),
    { value: 1000 / 2405.69, source: 'loaded' });
  assert.deepEqual(importedTripRatePerMile({ rate: 1000 }, { loadedMiles: 1000 }, { totalMiles: 1200 }),
    { value: 1000 / 1200, source: 'total' });
  assert.deepEqual(importedTripRatePerMile({ rate: 1000 }, { loadedMiles: 0 }, { totalMiles: null }),
    { value: null, source: 'total' });
  assert.deepEqual(importedTripRatePerMile({ rate: null }, { loadedMiles: 1000 }, null),
    { value: null, source: 'total' });
});
test('import assignment requires a real driver and open status, not a clean PDF review', () => {
  const load = { id: 'load', lifecycleStatus: 'review', review: { required: true, blockingFields: [] } };
  const drivers = [{ id: 'driver' }];
  assert.equal(canAssignImportedLoad(load, 'driver', drivers), true);
  assert.equal(canAssignImportedLoad({ ...load, id: null, previewTicket: { payload: 'signed' } }, 'driver', drivers), true);
  assert.equal(canAssignImportedLoad({ ...load, id: null, previewTicket: null }, 'driver', drivers), false);
  assert.equal(canAssignImportedLoad(load, 'missing', drivers), false);
  assert.equal(canAssignImportedLoad(load, 'driver', drivers, true), false);
  assert.equal(canAssignImportedLoad({ ...load, review: { blockingFields: ['pickup.addressLine'] } }, 'driver', drivers), true);
  assert.equal(canAssignImportedLoad({ ...load, review: { required: true,
    blockingFields: ['isHazmat', 'billingEmail', 'requiredDocuments', 'pickup.contactPhone', 'stops.0.contactPhone'] } }, 'driver', drivers), true);
  assert.equal(canAssignImportedLoad({ ...load, review: { blockingFields: ['multiStopDriverWorkflow'] } }, 'driver', drivers), true);
  assert.equal(canAssignImportedLoad({ ...load, lifecycleStatus: 'completed' }, 'driver', drivers), false);
  assert.equal(canAssignImportedLoad({ ...load, importError: 'failed' }, 'driver', drivers), false);
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
