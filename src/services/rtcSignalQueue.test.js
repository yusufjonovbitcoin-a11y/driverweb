import test from 'node:test';
import assert from 'node:assert/strict';

import { RtcSignalQueue } from './rtcSignalQueue.js';

const signal = (id, kind = 'ice') => ({ id, kind });

test('keeps signals pending until the peer is ready', async () => {
  const processed = [];
  const queue = new RtcSignalQueue({
    process: async (item) => processed.push(item.id),
  });

  queue.enqueue(signal(1, 'offer'));
  assert.deepEqual(processed, []);
  assert.equal(queue.pendingCount, 1);

  await queue.drain();
  assert.deepEqual(processed, [1]);
  assert.equal(queue.pendingCount, 0);
});

test('deduplicates pending and successfully processed signals', async () => {
  const processed = [];
  const queue = new RtcSignalQueue({
    process: async (item) => processed.push(item.id),
  });

  queue.enqueue(signal(1));
  queue.enqueue(signal(1));
  await queue.drain();
  queue.enqueue(signal(1));
  await queue.drain();

  assert.deepEqual(processed, [1]);
});

test('retains a failed signal so a later drain can retry it', async () => {
  let attempts = 0;
  const queue = new RtcSignalQueue({
    process: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('peer not ready');
    },
  });

  queue.enqueue(signal(1, 'offer'));
  await assert.rejects(queue.drain(), /peer not ready/);
  assert.equal(queue.pendingCount, 1);

  await queue.drain();
  assert.equal(attempts, 2);
  assert.equal(queue.pendingCount, 0);
});

test('serializes signals added while a drain is running', async () => {
  const processed = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = new RtcSignalQueue({
    process: async (item) => {
      if (item.id === 1) await firstBlocked;
      processed.push(item.id);
    },
  });

  queue.enqueue(signal(1, 'offer'));
  const draining = queue.drain();
  queue.enqueue(signal(2, 'ice'));
  releaseFirst();
  await draining;

  assert.deepEqual(processed, [1, 2]);
});
