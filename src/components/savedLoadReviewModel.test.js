import test from 'node:test';
import assert from 'node:assert/strict';
import { savedLoadReviewDetails, loadReviewRequirementRows } from './savedLoadReviewModel.js';

const details = { number: '#2536705', broker: 'Current Broker', brokerContact: 'Jane', brokerPhone: '+15555550123',
  brokerEmail: 'jane@example.com', rate: 2000, distanceMiles: 500, weightLbs: 35000, equipment: '53 Feet',
  commodity: 'Lubricant', temperature: null, pallets: null, cases: null, isHazmat: true, requirements: ['Current instruction'],
  specialInstructions: 'Use dock 3', stops: [{ role: 'pickup', markerLabel: 'P1', address: '1 Road', scheduleDate: '2026-10-01', scheduleTime: '08:00–15:30' },
    { role: 'pickup', markerLabel: 'P2', address: '2 Road' }, { role: 'delivery', markerLabel: 'D1', address: '3 Road' }, { role: 'delivery', markerLabel: 'D2', address: '4 Road' }] };
const extracted = { fields: [{ key: 'weightLbs', value: 1000, page: 1 }, { key: 'weightPrinted', value: '1,000 lb', page: 1 },
  { key: 'cargoDescription', value: 'Lubricant', page: 2 }, { key: 'lengthPrinted', value: '53 Feet', page: 2 }],
  weight: 1000, weightPrinted: '1,000 lb', requirements: [], stops: [{ address: 'Old Pickup' }, { address: 'Old Delivery' }] };

test('saved values replace stale extraction while retaining matching source evidence', () => {
  const review = savedLoadReviewDetails({}, details, extracted);
  assert.equal(review.number, '#2536705');
  assert.equal(review.weight, 35000);
  assert.equal(review.weightPrinted, null);
  assert.deepEqual(review.fields.map(field => field.key), ['cargoDescription', 'lengthPrinted']);
  assert.equal(review.fields[0].page, 2);
  assert.equal(review.broker, 'Current Broker');
  assert.equal(review.instructions, 'Use dock 3');
  assert.deepEqual(review.requirements, ['Current instruction']);
});
test('all canonical pickups and deliveries survive a legacy two-stop extraction', () => {
  const review = savedLoadReviewDetails({}, details, extracted);
  assert.deepEqual(review.stops.map(stop => stop.markerLabel), ['P1', 'P2', 'D1', 'D2']);
  assert.deepEqual(review.stops.map(stop => stop.address), ['1 Road', '2 Road', '3 Road', '4 Road']);
  assert.equal(review.stops[0].scheduledDate, '2026-10-01');
  assert.equal(review.stops[0].timePrinted, '08:00–15:30');
});
test('unknown rates and miles do not reappear from an earlier snapshot', () => {
  const review = savedLoadReviewDetails({ rateKnown: false, distanceKnown: false }, details,
    { ...extracted, fields: [{ key: 'brokerRate', value: 2000 }, { key: 'loadedMiles', value: 500 }] });
  assert.equal(review.rate, null);
  assert.equal(review.distance, null);
  assert.deepEqual(review.fields, []);
});
test('loads without PDF fields retain operational cargo, broker and requirements', () => {
  const review = savedLoadReviewDetails({}, details, { fields: [], requirements: [], stops: [] });
  assert.equal(review.operationalOnly, true);
  assert.equal(review.cargo, 'Lubricant');
  assert.equal(review.hazmat, true);
  assert.equal(review.brokerPhone, '+15555550123');
  assert.equal(review.stops.length, 4);
});

test('updated and cleared requirements/instructions never revive historical PDF content', () => {
  const snapshot = { ...extracted, requirements: ['Old requirement'], instructions: 'Old instructions',
    fields: [...extracted.fields, { key: 'requirements.0', value: 'Old requirement', page: 1 },
      { key: 'specialInstructions', value: 'Old instructions', page: 1 }] };
  const review = savedLoadReviewDetails({}, { ...details, requirements: [], specialInstructions: null }, snapshot);
  assert.deepEqual(review.requirements, []);
  assert.equal(review.instructions, null);
  assert.ok(review.fields.every(field => !field.key.startsWith('requirements.') && field.key !== 'specialInstructions'));
});

test('partial source evidence never hides a newly updated requirement', () => {
  const review = savedLoadReviewDetails({}, { ...details, requirements: ['Keep seal', 'Call before arrival'] },
    { ...extracted, requirements: ['Keep seal', 'Old second instruction'], fields: [
      { key: 'requirements.0', value: 'Keep seal', page: 1 },
      { key: 'requirements.1', value: 'Old second instruction', page: 2 },
    ] });
  const rows = loadReviewRequirementRows(review);
  assert.deepEqual(rows.map(row => row.value), ['Keep seal', 'Call before arrival']);
  assert.equal(rows[0].page, 1);
  assert.equal(rows[1].page, undefined);
});
