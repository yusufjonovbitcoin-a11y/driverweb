import test from 'node:test';
import assert from 'node:assert/strict';
import { accountingFields, moneyCents, accountingPayload, accountingPreview, accountingErrorKey } from './tripAccounting.js';

const zero = Object.fromEntries(accountingFields.map(key => [key, '0']));
test('blank is unknown and a genuine zero remains zero', () => {
  assert.equal(moneyCents(''), null);
  assert.equal(moneyCents(null), null);
  assert.equal(moneyCents('0'), 0);
  assert.equal(accountingPreview(100, {}).balance, null);
  assert.equal(accountingPreview(100, zero).balance, 100);
});
test('money uses exact integer cents and accepts decimal commas', () => {
  assert.equal(moneyCents('0.10'), 10);
  assert.equal(moneyCents('0,20'), 20);
  assert.equal(accountingPreview('1', { ...zero, fuel_cost: '0.10', toll_cost: '0.20' }).balance, 0.7);
  assert.equal(accountingPayload({ ...zero, fuel_cost: '1,20' }).fuel_cost, '1.20');
});
test('reject negatives, extra precision, invalid text and oversized values', () => {
  for (const value of ['-1', '1.001', '1e3', 'NaN', 'Infinity', '10000000000', '1,000.00', 'abc']) {
    assert.throws(() => moneyCents(value), /ACCOUNTING_INVALID/);
  }
  assert.equal(moneyCents('9999999999.99'), 999999999999);
});
test('calculate cumulative expenses, trip balance and receivable separately', () => {
  assert.deepEqual(accountingPreview(3000, { additional_income: '100', driver_pay: '1200', fuel_cost: '500', toll_cost: '20', other_cost: '80', broker_paid: '2500' }), {
    revenue: 3100, costs: 1800, balance: 1300, outstanding: 600,
  });
});
test('partial expense records never produce a balance', () => {
  assert.equal(accountingPreview(3000, { ...zero, driver_pay: '' }).balance, null);
  assert.equal(accountingPreview(3000, { ...zero, additional_income: '' }).balance, null);
  assert.equal(accountingPreview(null, zero).balance, null);
  assert.equal(accountingPreview(3000, { ...zero, broker_paid: '' }).outstanding, null);
});
test('losses and overpayments are retained, not clamped to zero', () => {
  const actual = accountingPreview(100, { ...zero, fuel_cost: '120', broker_paid: '150' });
  assert.equal(actual.balance, -20);
  assert.equal(actual.outstanding, -50);
});
test('payload retains all unknowns and normalized fixed decimal strings', () => {
  const payload = accountingPayload({ driver_pay: '123.4' });
  assert.equal(payload.driver_pay, '123.40');
  assert.equal(payload.fuel_cost, null);
  assert.deepEqual(Object.keys(payload), accountingFields);
});
test('server concurrency and generic network errors have safe messages', () => {
  assert.equal(accountingErrorKey(new Error('ACCOUNTING_CONFLICT')), 'analytics.errors.ACCOUNTING_CONFLICT');
  assert.equal(accountingErrorKey(new Error('private server failure')), 'analytics.errors.general');
});
