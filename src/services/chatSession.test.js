import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatOutbox, ChatSessionCache, clearPersistedChatSession } from './chatSession.js';

const storage = () => {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index], getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const message = (id, fields = {}) => ({ id, created_at: `2026-10-01T00:00:${String(id).padStart(2, '0')}Z`, kind: 'text', body: `message ${id}`, ...fields });

test('delayed INSERT cannot resurrect a tombstone; older revisions cannot undo edits', () => {
  const cache = new ChatSessionCache('alice', { storage: null });
  cache.merge('driver', [message('1', { revision: 2, body: 'edited' })]);
  assert.equal(cache.merge('driver', [message('1', { revision: 1 })])[0].body, 'edited');
  cache.merge('driver', [message('1', { revision: 3, deleted_at: '2026-10-01T01:00:00Z' })]);
  assert.equal(cache.merge('driver', [message('1', { revision: 1, mediaUrl: 'late' })]).length, 0);
});

test('bounded recent history and drafts survive reload without signed URLs or account leakage', () => {
  const disk = storage();
  const cache = new ChatSessionCache('alice:company-one', { storage: disk });
  const entry = cache.get('driver'); entry.conversationId = 'conversation';
  cache.setDraft('driver', 'unfinished');
  cache.merge('driver', Array.from({ length: 150 }, (_, index) => ({ id: String(index), created_at: new Date(1700000000000 + index).toISOString(), body: 'test', mediaUrl: 'https://private.invalid?token=secret', access_token: 'secret' })));
  cache.flush();
  const reloaded = new ChatSessionCache('alice:company-one', { storage: disk }).get('driver');
  assert.equal(reloaded.messages.length, 100);
  assert.equal(reloaded.draft, 'unfinished');
  assert.equal(reloaded.hasMore, true);
  assert.equal(reloaded.messages.some((row) => row.mediaUrl || row.access_token), false);
  assert.equal(new ChatSessionCache('bob:company-two', { storage: disk }).get('driver').messages.length, 0);
});

test('old-history windows stay contiguous when a new live message arrives', () => {
  const cache = new ChatSessionCache('scope', { storage: null, messageLimit: 3 });
  cache.merge('driver', [message('4'), message('5'), message('6')]);
  cache.merge('driver', [message('2'), message('3')], { older: true });
  assert.deepEqual(cache.get('driver').messages.map((row) => row.id), ['2', '3', '4']);
  cache.merge('driver', [message('7')]);
  assert.deepEqual(cache.get('driver').messages.map((row) => row.id), ['2', '3', '4']);
  assert.equal(cache.get('driver').detached, true);
  cache.merge('driver', [message('5'), message('6'), message('7')], { replaceWindow: true });
  assert.equal(cache.get('driver').detached, false);
  assert.deepEqual(cache.get('driver').messages.map((row) => row.id), ['5', '6', '7']);
});

test('LRU eviction bounds conversation memory', () => {
  const cache = new ChatSessionCache('scope', { storage: null, limit: 2 });
  cache.get('a'); cache.get('b'); cache.get('a'); cache.get('c');
  assert.deepEqual([...cache.entries.keys()], ['a', 'c']);
});

test('persisted older-history windows retain their newer-message boundary after reload', () => {
  const disk = storage();
  const cache = new ChatSessionCache('scope', { storage: disk, messageLimit: 3 });
  cache.merge('driver', [message('4'), message('5'), message('6')]);
  cache.merge('driver', [message('2'), message('3')], { older: true });
  cache.flush();
  const restored = new ChatSessionCache('scope', { storage: disk, messageLimit: 3 });
  assert.equal(restored.get('driver').detached, true);
  restored.merge('driver', [message('7')]);
  assert.deepEqual(restored.get('driver').messages.map((row) => row.id), ['2', '3', '4']);
  restored.merge('driver', [message('5'), message('6'), message('7')], { replaceWindow: true });
  restored.flush();
  assert.equal(new ChatSessionCache('scope', { storage: disk }).get('driver').detached, false);
});

test('another tab cannot resurrect history or pending text after account logout', async () => {
  const disk = storage();
  const cache = new ChatSessionCache('alice', { storage: disk });
  cache.merge('driver', [message('1', { body: 'private' })]); cache.flush();
  const otherTab = new ChatSessionCache('alice', { storage: disk });
  const outbox = new ChatOutbox('alice', disk, () => 'stable');
  const row = outbox.enqueue('chat', 'alice', 'private pending');
  let reject;
  const sending = outbox.send(row, () => new Promise((_, fail) => { reject = fail; }));
  await Promise.resolve();
  clearPersistedChatSession('alice', disk);
  reject(new Error('late failure')); await assert.rejects(sending);
  otherTab.flush(); cache.flush();
  assert.equal(new ChatSessionCache('alice', { storage: disk }).get('driver').messages.length, 0);
  assert.equal(new ChatOutbox('alice', disk).list().length, 0);
  assert.throws(() => outbox.enqueue('chat', 'alice', 'late'), /CHAT_ACCOUNT_CHANGED/);
});

test('logout interleaved between cache generation check and disk write removes the late write', () => {
  const disk = storage(); const originalSet = disk.setItem;
  const cache = new ChatSessionCache('alice', { storage: disk });
  cache.merge('driver', [message('1')]);
  disk.setItem = (key, value) => {
    if (key.startsWith('drivex-chat-cache:')) clearPersistedChatSession('alice', disk);
    originalSet(key, value);
  };
  cache.flush();
  assert.equal(new ChatSessionCache('alice', { storage: disk }).get('driver').messages.length, 0);
  assert.equal(cache.closed, true);
});

test('persistent outbox retries the same client ID after synchronous and ambiguous failures', async () => {
  const disk = storage(); let id = 0;
  const outbox = new ChatOutbox('alice', disk, () => String(++id));
  const row = outbox.enqueue('conversation', 'alice', 'Hello');
  await assert.rejects(outbox.send(row, () => { throw new Error('sync failure'); }));
  await assert.rejects(outbox.send(row, async () => { throw new Error('committed but response lost'); }));
  const reloaded = new ChatOutbox('alice', disk);
  const pending = reloaded.list()[0];
  assert.equal(pending.client_id, row.client_id);
  const result = await reloaded.send(pending, async (retry) => ({ id: 'server-id', client_id: retry.client_id }));
  assert.equal(result.client_id, row.client_id);
  assert.equal(reloaded.list().length, 0);
});

test('simultaneous retry buttons share one transport request', async () => {
  const outbox = new ChatOutbox('scope', storage(), () => 'same-id');
  const row = outbox.enqueue('chat', 'alice', 'Hello');
  let resolve; let calls = 0;
  const response = new Promise((done) => { resolve = done; });
  const deliver = () => { calls++; return response; };
  const first = outbox.send(row, deliver); const second = outbox.send(row, deliver);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ id: 'saved' }); await Promise.all([first, second]);
  assert.equal(outbox.list().length, 0);
});

test('outbox prunes expired keys only for this account and rejects oversized text before storing it', () => {
  const disk = storage(); let id = 0;
  const alice = new ChatOutbox('alice', disk, () => `alice-${++id}`);
  const bob = new ChatOutbox('bob', disk, () => 'bob');
  const old = alice.enqueue('chat', 'alice', 'old');
  bob.enqueue('other', 'bob', 'retained');
  disk.setItem(`${alice.key}:${old.client_id}`, JSON.stringify({ ...old, created_at: '2020-01-01T00:00:00Z' }));
  alice.refresh();
  assert.equal(alice.list().length, 0);
  assert.equal(disk.getItem(`${alice.key}:${old.client_id}`), null);
  assert.equal(new ChatOutbox('bob', disk).list().length, 1);
  assert.throws(() => alice.enqueue('chat', 'alice', 'a'.repeat(4001)), /CHAT_MESSAGE_TOO_LONG/);
  assert.equal(alice.list().length, 0);
  for (let index = 0; index < 100; index++) alice.enqueue('chat', 'alice', 'pending');
  assert.throws(() => alice.enqueue('chat', 'alice', 'extra'), /CHAT_OUTBOX_FULL/);
  assert.equal(alice.list().length, 100);
});

test('a realtime acknowledgement followed by a transport error does not restore a failed bubble', async () => {
  const disk = storage();
  const outbox = new ChatOutbox('alice', disk, () => 'stable');
  const row = outbox.enqueue('chat', 'alice', 'committed');
  await assert.rejects(outbox.send(row, async () => {
    outbox.acknowledge(row.client_id);
    throw new Error('response lost after commit');
  }));
  assert.equal(outbox.list().length, 0);
  assert.equal(new ChatOutbox('alice', disk).list().length, 0);
});

test('two browser tabs use one operation lock and cannot send the same persisted row twice', async () => {
  const disk = storage(); let tail = Promise.resolve(); let calls = 0;
  const locks = { request: (_, run) => { const next = tail.then(run); tail = next.catch(() => {}); return next; } };
  const first = new ChatOutbox('same-account', disk, () => 'stable', locks);
  const row = first.enqueue('chat', 'alice', 'once');
  const second = new ChatOutbox('same-account', disk, () => 'other', locks);
  const deliver = async () => { calls++; return { id: 'stored' }; };
  const results = await Promise.all([first.send(row, deliver), second.send(second.list()[0], deliver)]);
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ id: 'stored' }, null]);
});

test('clearing one outbox cannot affect another user and late requests cannot repersist after logout', async () => {
  const disk = storage();
  const alice = new ChatOutbox('alice:one', disk, () => 'alice');
  const bob = new ChatOutbox('bob:two', disk, () => 'bob');
  const row = alice.enqueue('chat', 'alice', 'private'); bob.enqueue('other', 'bob', 'other');
  let reject;
  const pending = alice.send(row, () => new Promise((_, fail) => { reject = fail; }));
  await Promise.resolve(); alice.clear(); reject(new Error('late response')); await assert.rejects(pending);
  assert.equal(new ChatOutbox('alice:one', disk).list().length, 0);
  assert.equal(new ChatOutbox('bob:two', disk).list().length, 1);
});
