import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadDetails } from './loadDetailsModel.js';

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
