import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadDetails } from './loadDetailsModel.js';

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
    origin: { facility: 'FOUR SEASONS', address: '400 Wabash Rd', appointmentAt: '2026-09-23T08:59:00Z' },
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
