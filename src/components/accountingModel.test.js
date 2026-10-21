import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyCents, percentageBasisPoints, commissionCents, loadRateCents, isAssignedAccountingLoad } from './accountingModel.js';
test('decimal amounts and commission round half up without floating-point drift', () => {
  assert.equal(moneyCents('1.005'), 101);
  assert.equal(moneyCents('5300.00'), 530000);
  assert.equal(percentageBasisPoints('12.25'), 1225);
  assert.equal(commissionCents(101, 5000), 51);
  assert.equal(commissionCents(530000, 1225), 64925);
  for (const value of ['', '-1', '101', '1.234', 'NaN']) assert.equal(percentageBasisPoints(value), null);
  assert.equal(commissionCents(100, null), null);
  assert.equal(moneyCents('-10'), null);
});

test('unknown rates are never treated as confirmed zero or commission base', () => {
  assert.equal(loadRateCents({ rate: 0, rateKnown: false }), null);
  assert.equal(loadRateCents({ rate: 100, rateKnown: false }), null);
  assert.equal(loadRateCents({ rate: 0, rateKnown: true }), 0);
  assert.equal(commissionCents(loadRateCents({ rate: 100, rateKnown: false }), 1000), null);
});

test('driver accounting excludes unassigned drafts and explicit non-USD amounts', () => {
  assert.equal(isAssignedAccountingLoad({ driverId: null, rate: 16000000 }), false);
  assert.equal(isAssignedAccountingLoad({ driverId: '', rate: 100 }), false);
  assert.equal(isAssignedAccountingLoad({ driverId: 'driver', rate: 100 }), true);
  assert.equal(isAssignedAccountingLoad({ driverId: 'driver', currency: 'USD' }), true);
  assert.equal(isAssignedAccountingLoad({ driverId: 'driver', currency: 'UZS' }), false);
});


test('ledger totals weight rates by miles and preserve unknown amounts', async () => {
  const { accountingLedgerTotals, accountingDeliveryTimestamp, accountingMiles } = await import('./accountingModel.js');
  const totals = accountingLedgerTotals([{ rate: 5300, distanceMiles: 1417 }, { rate: 3200, distanceMiles: 1210 }], 1000);
  assert.equal(totals.gross, 850000); assert.equal(totals.pay, 765000); assert.equal(totals.miles, 2627); assert.equal(totals.rate, 8500 / 2627);
  assert.equal(accountingLedgerTotals([{ rate: 0, rateKnown: false, distanceMiles: 100 }], 1000).pay, null);
  assert.equal(accountingLedgerTotals([{ rate: 500, distanceKnown: false, distanceMiles: 0 }], 1000).rate, null);
  assert.equal(accountingLedgerTotals([{ rate: 500, distanceMiles: 0 }], null).pay, null);
  assert.equal(accountingMiles({ distanceMiles: -1 }), null);
  assert.equal(accountingDeliveryTimestamp({ destination: { date: '2026-07-21' }, status: 'DELIVERED' }), null);
  assert.equal(accountingDeliveryTimestamp({ deliveredAt: '2026-07-21T12:00:00Z' }), '2026-07-21T12:00:00Z');
});
