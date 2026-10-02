import assert from 'node:assert/strict';
import test from 'node:test';
import { isCompleteVin, parseNhtsaVinResult, retryVinLookup } from './nhtsaVin.js';

const vin = '4V4BC9EH7TN704159';

test('normalizes complete VIN and maps the NHTSA flat response', () => {
  assert.equal(isCompleteVin('4v4bc9eh7tn704159'), true);
  assert.deepEqual(parseNhtsaVinResult({ Results: [{
    VIN: vin,
    ErrorCode: '0',
    Make: 'VOLVO TRUCK',
    Model: 'VNL (4)',
    ModelYear: '2026',
    FuelTypePrimary: 'Diesel',
  }] }, vin, new Date('2026-10-01')), {
    make: 'VOLVO TRUCK', model: 'VNL (4)', modelYear: '2026', fuelType: 'diesel',
  });
});

test('rejects invalid and mismatched NHTSA responses', () => {
  assert.equal(isCompleteVin('4V4BC9EH7TN70415I'), false);
  assert.equal(parseNhtsaVinResult({ Results: [{ VIN: vin, ErrorCode: '7', Make: 'VOLVO' }] }, vin), null);
  assert.equal(parseNhtsaVinResult({ Results: [{ VIN: '1FD8W3HT5GEC54393', ErrorCode: '0' }] }, vin), null);
});

test('retries a transient decoder failure', async () => {
  let calls = 0;
  const result = await retryVinLookup(async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary network error');
    return { Make: 'FREIGHTLINER' };
  }, { delayMs: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(result, { Make: 'FREIGHTLINER' });
});

test('does not retry a cancelled decoder request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(retryVinLookup(async () => {
    calls += 1;
    controller.abort();
    throw new Error('cancelled');
  }, { signal: controller.signal, delayMs: 0 }), /cancelled/);
  assert.equal(calls, 1);
});
