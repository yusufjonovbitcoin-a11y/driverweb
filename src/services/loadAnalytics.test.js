import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLoadAnalytics } from './loadAnalytics.js';

test('empty data produces no invented brokers, equipment, or RPM', () => {
  const stats = aggregateLoadAnalytics([]);
  assert.equal(stats.count, 0);
  assert.equal(stats.contractAmount, 0);
  assert.equal(stats.miles, 0);
  assert.equal(stats.rpm, null);
  assert.deepEqual(stats.brokers, []);
  assert.deepEqual(stats.equipment, []);
});
test('explicit zero contract amount is known and differs from missing amount', () => {
  assert.equal(aggregateLoadAnalytics([{ rate: 0, distanceMiles: 50 }]).rpm, 0);
  const stats = aggregateLoadAnalytics([{ rate: null, distanceMiles: '' }]);
  assert.equal(stats.contractAmount, null);
  assert.equal(stats.miles, null);
  assert.equal(stats.brokers[0].amount, null);
});
test('RPM uses only loads with both known rate and positive distance', () => {
  const stats = aggregateLoadAnalytics([
    { rate: '100', distanceMiles: '50' },
    { rate: null, distanceMiles: 100 },
    { rate: 500, distanceMiles: null },
    { rate: 30, distanceMiles: 0 },
  ]);
  assert.equal(stats.rpm, 2);
  assert.equal(stats.rpmLoads, 1);
  assert.equal(stats.knownRates, 3);
  assert.equal(stats.knownDistances, 3);
  assert.equal(stats.contractAmount, 630);
});
test('broker and equipment distributions are load counts derived from real rows', () => {
  const stats = aggregateLoadAnalytics([
    { broker: 'TQL', equipment: 'Reefer', rate: 0 },
    { broker: ' TQL ', equipment: 'Reefer', rate: 120 },
    { broker: 'Other', equipment: 'Dry van', rate: null },
  ]);
  assert.deepEqual(stats.brokers[0], { name: 'TQL', count: 2, amount: 120, knownRates: 2, percent: 2 / 3 * 100 });
  assert.equal(stats.equipment[0].count, 2);
  assert.equal(stats.equipment.reduce((sum, item) => sum + item.count, 0), 3);
});
test('invalid monetary values and unknown labels remain unknown', () => {
  const stats = aggregateLoadAnalytics([null, { rate: Infinity, distanceMiles: -4, broker: '', equipment: '—' }, { rate: true, distanceMiles: {} }]);
  assert.equal(stats.count, 2);
  assert.equal(stats.knownRates, 0);
  assert.equal(stats.knownDistances, 0);
  assert.equal(stats.equipment[0].name, 'Texnika ko‘rsatilmagan');
});

test('mapping availability flags exclude missing database values without discarding explicit zeros', () => {
  const stats = aggregateLoadAnalytics([
    { rate: 0, rateKnown: false, distanceMiles: 100, distanceKnown: true },
    { rate: 0, rateKnown: true, distanceMiles: 50, distanceKnown: true },
    { rate: 80, rateKnown: true, distanceMiles: 0, distanceKnown: false },
    { rate: 0, rateKnown: false, distanceMiles: 0, distanceKnown: false },
  ]);
  assert.equal(stats.knownRates, 2);
  assert.equal(stats.knownDistances, 2);
  assert.equal(stats.contractAmount, 80);
  assert.equal(stats.miles, 150);
  assert.equal(stats.rpmLoads, 1);
  assert.equal(stats.rpm, 0);
  assert.equal(stats.brokers[0].knownRates, 2);
  const unknown = aggregateLoadAnalytics([{ rate: 0, rateKnown: false, distanceMiles: 0, distanceKnown: false }]);
  assert.equal(unknown.contractAmount, null);
  assert.equal(unknown.miles, null);
});
