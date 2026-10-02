import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaSends, PendingSends, createBatchedNotifier, reconcileHistory } from './chatTransport.js';
import { mergeChatMessages } from './chatReliability.js';

test('reconnect traverses every missing page and applies offline deletions', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i).padStart(4, '0'), created_at: new Date(1700000000000 + i * 1000).toISOString() }));
  rows[20].deleted_at = new Date().toISOString();
  const previous = rows.slice(0, 50).map((row) => ({ ...row, deleted_at: null }));
  let calls = 0;
  const result = await reconcileHistory(async (cursor) => {
    calls++;
    const page = rows.filter((row) => !cursor || row.id < cursor.id).slice(-100);
    return { messages: page, cursor: { id: page[0].id, createdAt: page[0].created_at }, hasMore: page.length === 100 };
  }, { id: rows[0].id, createdAt: rows[0].created_at });
  const merged = mergeChatMessages(previous, result.messages);
  assert.equal(calls, 3);
  assert.equal(merged.length, 249);
  assert.equal(merged.some((row) => row.id === rows[20].id), false);
  assert.equal(merged.at(-1).id, '0249');
});
test('cancelled reconciliation cannot mutate the next conversation', async () => {
  assert.equal(await reconcileHistory(async () => ({ messages: [], hasMore: false }), null, () => false), null);
});
test('pending send survives retry/reload without storing the message text', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const first = new PendingSends(storage, () => 'first');
  assert.equal(first.get('user:chat:digest'), 'first');
  const reload = new PendingSends(storage, () => 'next');
  assert.equal(reload.get('user:chat:digest'), 'first');
  reload.complete('user:chat:digest');
  assert.equal(reload.get('user:chat:digest'), 'next');
  assert.equal(reload.get('other-user:chat:digest'), 'next');
});
test('a receipt burst sends one notification to each consumer', async () => {
  const notifier = createBatchedNotifier(5);
  let a = 0; let b = 0;
  notifier.subscribe(() => a++);
  const off = notifier.subscribe(() => b++);
  for (let i = 0; i < 100; i++) notifier.notify();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a, 1); assert.equal(b, 1);
  off(); notifier.notify();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a, 2); assert.equal(b, 1);
  notifier.clear();
});

test('lost media commit response retries the same upload and operation ID', async () => {
  const sends = new MediaSends(() => 'stable-id');
  const file = {};
  let uploads = 0;
  const committed = new Map();
  const upload = async () => { uploads++; return { reference: 'cloudinary:asset' }; };
  await assert.rejects(sends.send(file, 'user:conversation', upload, async (id, reference) => {
    committed.set(id, { id, reference });
    throw new Error('Response lost after commit');
  }));
  const result = await sends.send(file, 'user:conversation', upload, async (id, reference) => {
    assert.equal(reference, 'cloudinary:asset');
    return committed.get(id);
  });
  assert.equal(result.id, 'stable-id');
  assert.equal(uploads, 1);
  assert.equal(committed.size, 1);
});

test('pending media never crosses user or conversation boundaries', async () => {
  let sequence = 0; let uploads = 0;
  const sends = new MediaSends(() => `${++sequence}`);
  const file = {};
  const upload = async () => ({ reference: `asset-${++uploads}` });
  await assert.rejects(sends.send(file, 'first', upload, async () => { throw new Error('offline'); }));
  const message = await sends.send(file, 'second', upload, async (id, reference) => ({ id, reference }));
  assert.deepEqual(message, { id: '2', reference: 'asset-2' });
});
