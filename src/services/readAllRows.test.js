import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows, readAllPages, mapWithConcurrency } from './readAllRows.js';

test('reads every row even when API cap is smaller than page size', async () => {
  const source = Array.from({ length: 1207 }, (_, id) => ({ id }));
  let calls = 0;
  const result = await readAllRows(() => {
    let after = -1;
    return { order() { return this; }, limit() { return this; }, gt(_, value) { after = value; return this; },
      then(resolve) { calls++; resolve({ data: source.filter(row => row.id > after).slice(0, 73) }); } };
  });
  assert.deepEqual(result, source);
  assert.equal(calls, 18);
});

test('partial fetch fails rather than replacing full driver data with incomplete rows', async () => {
  let calls = 0;
  await assert.rejects(readAllRows(() => ({ order() { return this; }, limit() { return this; }, gt() { return this; },
    then(resolve) { resolve(++calls === 1 ? { data: [{ id: 'a' }] } : { error: new Error('offline') }); } })), /offline/);
});

test('rejects a non-advancing cursor', async () => {
  await assert.rejects(readAllRows(() => ({ order() { return this; }, limit() { return this; }, gt() { return this; },
    then(resolve) { resolve({ data: [{ id: 'a' }] }); } })), /cursor/);
});

test('grouped view pages use actual received length, not requested API cap', async () => {
  const source = Array.from({ length: 15 }, (_, id) => ({ document_id: Math.floor(id / 3), check_id: id }));
  const result = await readAllPages(() => ({ range(from) { return Promise.resolve({ data: source.slice(from, from + 4) }); } }));
  assert.deepEqual(result, source);
});

test('media hydration bounds concurrent requests and preserves order', async () => {
  let running = 0, max = 0;
  const result = await mapWithConcurrency([1,2,3,4,5,6,7], async value => {
    running++; max = Math.max(max, running);
    await new Promise(resolve => setTimeout(resolve, 1)); running--;
    return value * 2;
  }, 3);
  assert.equal(max, 3);
  assert.deepEqual(result, [2,4,6,8,10,12,14]);
});
