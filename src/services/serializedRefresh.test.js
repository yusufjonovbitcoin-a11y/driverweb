import assert from 'node:assert/strict';
import test from 'node:test';
import { createSerializedRefresh } from './serializedRefresh.js';

test('overlapping refreshes run one fresh follow-up, never parallel reads', async () => {
  let release;
  let calls = 0;
  let active = 0;
  let peak = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const refresh = createSerializedRefresh(async () => {
    calls += 1;
    peak = Math.max(peak, ++active);
    if (calls === 1) await gate;
    active -= 1;
  });
  const first = refresh();
  await Promise.resolve();
  const mutationRefresh = refresh();
  assert.equal(first, mutationRefresh);
  for (let i = 0; i < 20; i += 1) refresh();
  release();
  await mutationRefresh;
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  await refresh();
  assert.equal(calls, 3);
});

test('failed refresh rejects waiters and allows retry', async () => {
  let calls = 0;
  const refresh = createSerializedRefresh(async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
  });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(calls, 2);
});

test('a refresh at completion cannot join an already-finished request', async () => {
  let release;
  let calls = 0;
  let second;
  const gate = new Promise(resolve => { release = resolve; });
  const refresh = createSerializedRefresh(async () => {
    calls += 1;
    if (calls === 1) await gate;
  });
  const first = refresh();
  await Promise.resolve();
  release();
  queueMicrotask(() => queueMicrotask(() => { second = refresh(); }));
  await first;
  await second;
  assert.equal(calls, 2);
});
