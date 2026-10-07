import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAiStops } from '../supabase/functions/_shared/load-ai-context.ts';

const stops = [{ sequence: 1, type: 'pickup', appointment_from: null }, { sequence: 2, type: 'delivery' }];
const brief = { version: 1, reviewedAt: '2026-10-07', blockingFields: [], fields: [
  { key: 'stops.0.scheduledDate', value: '10/08/2026', quote: 'private quote' },
  { key: 'stops.0.hours', value: '07:00-15:00' },
  { key: 'stops.1.referenceNumber', value: 'DEL-42' },
  { key: 'brokerRate', value: 4000 },
] };
test('reviewed source-only date, hours and references reach the correct AI stop without quotes', () => {
  const result = loadAiStops({ driver_brief: brief }, stops);
  assert.equal(result[0].documentDate, '10/08/2026');
  assert.equal(result[0].documentHours, '07:00-15:00');
  assert.equal(result[0].appointment_from, null);
  assert.equal(result[1].referenceNumber, 'DEL-42');
  assert.equal(result[0].referenceNumber, undefined);
  assert.ok(!JSON.stringify(result).includes('private quote'));
  assert.ok(!JSON.stringify(result).includes('brokerRate'));
});
test('hidden broker brief cannot leak; use only the server-projected operational facts', () => {
  for (const privacy of [{ broker_terms_hidden: true }, { driver_pay: { amount: 300 } }]) {
    const result = loadAiStops({ ...privacy, driver_brief: brief,
      driver_stop_details: { 'stops.0.timePrinted': 'FCFS 08:00-12:00' } }, stops);
    assert.equal(result[0].documentDate, undefined);
    assert.equal(result[1].referenceNumber, undefined);
    assert.equal(result[0].documentTime, 'FCFS 08:00-12:00');
  }
});
test('unreviewed/blocked facts and legacy aliases on multi-stop routes are excluded', () => {
  for (const b of [{ ...brief, reviewedAt: null }, { ...brief, blockingFields: ['loadNumber'] }]) {
    assert.equal(loadAiStops({ driver_brief: b }, stops)[0].documentDate, undefined);
  }
  const load = { driver_stop_details: { 'pickup.referenceNumber': 'LEGACY', 'stops.2.referenceNumber': 'LAST' } };
  const result = loadAiStops(load, [...stops, { sequence: 3, type: 'delivery' }]);
  assert.equal(result[0].referenceNumber, undefined);
  assert.equal(result[2].referenceNumber, 'LAST');
});
