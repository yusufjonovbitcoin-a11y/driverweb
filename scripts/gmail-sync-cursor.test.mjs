import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessageLimit, selectPendingUids } from './gmail-sync-cursor.mjs';

test('a backlog larger than the batch is consumed without skipped messages', () => {
  const candidates = Array.from({ length: 60 }, (_, index) => index + 101);
  let cursor = 100;
  const processed = [];
  for (let batch = 0; batch < 3; batch += 1) {
    const pending = selectPendingUids(candidates, cursor, 25);
    processed.push(...pending);
    cursor = pending.at(-1) ?? cursor;
  }
  assert.deepEqual(processed, candidates);
  assert.equal(cursor, 160);
  assert.deepEqual(selectPendingUids(candidates, cursor, 25), []);
});

test('UID selection orders, deduplicates and rejects stale or invalid results', () => {
  assert.deepEqual(selectPendingUids([16, 10, 14, '13', 14, NaN, 15.2], 12, 2), [13, 14]);
  assert.deepEqual(selectPendingUids([], 12, 25), []);
});

test('invalid worker batch limits cannot stall synchronization', () => {
  assert.equal(normalizeMessageLimit('bad-value'), 25);
  assert.equal(normalizeMessageLimit(Infinity), 25);
  assert.equal(normalizeMessageLimit(0), 1);
  assert.equal(normalizeMessageLimit(300), 100);
  assert.equal(normalizeMessageLimit(2.5), 2);
});
