import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoalescedAsyncTrigger } from './realtimeRefresh.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('coalesces a realtime event burst into one refresh', async () => {
  let calls = 0;
  const trigger = createCoalescedAsyncTrigger(async () => { calls += 1; }, {
    delayMs: 5,
    maxWaitMs: 20,
  });
  trigger();
  trigger();
  trigger();
  await wait(30);
  trigger.dispose();
  assert.equal(calls, 1);
});

test('queues one follow-up refresh while a refresh is in flight', async () => {
  let calls = 0;
  let release;
  const firstRun = new Promise((resolve) => { release = resolve; });
  const trigger = createCoalescedAsyncTrigger(async () => {
    calls += 1;
    if (calls === 1) await firstRun;
  }, { delayMs: 1, maxWaitMs: 10 });
  trigger();
  await wait(5);
  trigger();
  trigger();
  release();
  await wait(20);
  trigger.dispose();
  assert.equal(calls, 2);
});
