import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDriverMileageRate, prepareDriverPayAssignment } from './driverPay.js';
import { runLoadTrashAction } from './loadTrashActions.js';

test('rate accepts positive decimal USD, rejects empty, zero, NaN and excess precision', () => {
  for (const input of ['', '0', '-1', 'NaN', 'Infinity', '1e2', '0.12345','101']) {
    assert.equal(parseDriverMileageRate(input), null, input);
  }
  assert.equal(parseDriverMileageRate(' 0.6500 '), 0.65);
  assert.equal(parseDriverMileageRate('100'), 100);
});
test('quote never accepts client-computed mileage or money', async () => {
  const calls = [];
  await prepareDriverPayAssignment({ functions: { invoke: async (...args) => {
    calls.push(args); return { data: { fixedPay: true } };
  } } }, 'load', 'driver');
  assert.deepEqual(calls, [['calculate-load-route', { body: {
    loadId: 'load', driverIds: ['driver'], prepareDriverPay: true,
  } }]]);
});
test('failed quote prevents restore and surfaces specific GPS error', async () => {
  let restores = 0;
  const client = {
    functions: { invoke: async () => ({ error: { message:'Edge failed',
      context:{ json:async()=>({error:'DRIVER_PAY_GPS_REQUIRED'}) } } }) },
    rpc: async () => { restores++; },
  };
  await assert.rejects(runLoadTrashAction(client,'restore',{id:'load',version:1},'driver'), /GPS_REQUIRED/);
  assert.equal(restores,0);
});
