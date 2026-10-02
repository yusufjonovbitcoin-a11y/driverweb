import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTrip } from './tripAnalyticsDemo.js';
import { accountingPreview } from './tripAccounting.js';

test('exactly one clearly marked read-only demo fixture', () => {
  assert.equal(demoTrip.id, 'demo-trip-001');
  assert.equal(demoTrip.isDemo, true);
  assert.equal(Object.isFrozen(demoTrip), true);
  assert.equal(demoTrip.status, 'completed');
});

test('demo totals match the actual accounting formulas', () => {
  assert.deepEqual(accountingPreview(demoTrip.contract_amount, demoTrip), {
    revenue: 3150, costs: 1900, balance: 1250, outstanding: 1150,
  });
  assert.equal(demoTrip.balance, 1250);
  assert.equal(demoTrip.rpm, 12.5);
});
