import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatMediaOutbox, MEDIA_FILE_LIMIT, validateMediaQueue } from './chatMediaOutbox.js';

// Inject only the persistence boundary. Queue and retry code are production code.
class MemoryMediaStore {
  rows = new Map(); epochs = new Map();
  async epoch(scope) { return this.epochs.get(scope) || ''; }
  async list(scope) { return [...this.rows.values()].filter((row) => row.scope === scope); }
  async get(key) { return this.rows.get(key) || null; }
  async add(row) {
    if (row.storage_epoch !== await this.epoch(row.scope)) throw new Error('CHAT_ACCOUNT_CHANGED');
    validateMediaQueue([...this.rows.values()], row);
    this.rows.set(row.key, row);
  }
  async update(key, patch) { const current = this.rows.get(key); if (!current) return null; const row = { ...current, ...patch }; this.rows.set(key, row); return row; }
  async remove(key) { this.rows.delete(key); }
  async clear(scope) { this.epochs.set(scope, crypto.randomUUID()); for (const [key, row] of this.rows) if (row.scope === scope) this.rows.delete(key); }
}
const file = () => new File(['private bytes'], 'receipt.pdf', { type: 'application/pdf' });
const enqueue = (outbox, extra = {}) => outbox.enqueue({ file: file(), conversationId: 'conversation', senderId: 'alice', companyId: 'company', ...extra });

test('media Blob and stable operation survive reload and ambiguous commit response', async () => {
  const store = new MemoryMediaStore();
  const first = new ChatMediaOutbox('alice/company', { store });
  const row = await enqueue(first);
  await assert.rejects(first.send(row, async () => { throw new Error('commit response lost'); }));
  const restored = new ChatMediaOutbox('alice/company', { store }); await restored.restore();
  assert.equal(restored.list()[0].status, 'failed');
  assert.equal(restored.list()[0].client_id, row.client_id);
  assert.equal('blob' in restored.list()[0], false);
  assert.equal('mediaUrl' in store.rows.get(row.key), false);
  await restored.send(restored.list()[0], async (pending) => {
    assert.equal(await pending.blob.text(), 'private bytes');
    assert.equal(pending.file_name, 'receipt.pdf');
    assert.equal(pending.client_id, row.client_id);
    return { id: 'server-message', client_id: pending.client_id };
  });
  assert.equal((await store.list('alice/company')).length, 0);
});

test('file, total byte and pending count limits are enforced by actual budget validator', async () => {
  const outbox = new ChatMediaOutbox('alice', { store: new MemoryMediaStore() });
  class SizedBlob extends Blob { constructor(size) { super(); this.bytes = size; } get size() { return this.bytes; } }
  await assert.rejects(enqueue(outbox, { file: new File([], 'empty.pdf') }), /FILE_EMPTY/);
  await assert.rejects(enqueue(outbox, { file: new SizedBlob(MEDIA_FILE_LIMIT + 1) }), /FILE_TOO_LARGE/);
  const fullFile = { blob: { size: MEDIA_FILE_LIMIT } };
  assert.doesNotThrow(() => validateMediaQueue([fullFile, fullFile, fullFile], fullFile));
  assert.throws(() => validateMediaQueue([fullFile, fullFile, fullFile, fullFile], { blob: { size: 1 } }), /OUTBOX_FULL/);
  assert.throws(() => validateMediaQueue(Array.from({ length: 100 }, () => ({ blob: { size: 1 } })), { blob: { size: 1 } }), /OUTBOX_FULL/);
});

test('two tabs retry one media operation once under a shared lock', async () => {
  const store = new MemoryMediaStore(); let tail = Promise.resolve(); let calls = 0;
  const locks = { request: (_, run) => { const next = tail.then(run); tail = next.catch(() => {}); return next; } };
  const first = new ChatMediaOutbox('alice', { store, locks }); const row = await enqueue(first);
  const second = new ChatMediaOutbox('alice', { store, locks }); await second.restore();
  await Promise.all([first.send(row, async () => { calls++; return { id: 'saved' }; }), second.send(row, async () => { calls++; return { id: 'saved' }; })]);
  assert.equal(calls, 1);
  assert.equal(store.rows.size, 0);
});

test('another account cannot restore files; logout closes old tab writes and preserves the other account', async () => {
  const store = new MemoryMediaStore(); let generation = '';
  const oldTab = new ChatMediaOutbox('alice', { store, epoch: () => generation });
  await enqueue(oldTab);
  const bob = new ChatMediaOutbox('bob', { store }); await enqueue(bob, { senderId: 'bob' });
  assert.equal((await store.list('bob')).length, 1);
  generation = 'logged-out'; await store.clear('alice');
  await assert.rejects(enqueue(oldTab), /ACCOUNT_CHANGED/);
  assert.equal((await store.list('alice')).length, 0);
  assert.equal((await store.list('bob')).length, 1);
});

test('IndexedDB logout epoch also rejects late insert even without localStorage', async () => {
  const store = new MemoryMediaStore();
  const stale = new ChatMediaOutbox('alice', { store, epoch: () => '' }); await stale.restore();
  await store.clear('alice');
  await assert.rejects(enqueue(stale), /ACCOUNT_CHANGED/);
  assert.equal(store.rows.size, 0);
});

test('logout aborts transfer and late failure or acknowledgement cannot repersist a Blob', async () => {
  const store = new MemoryMediaStore(); const outbox = new ChatMediaOutbox('alice', { store });
  const row = await enqueue(outbox); let began;
  const started = new Promise((resolve) => { began = resolve; });
  const sending = outbox.send(row, (_pending, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))); began();
  }));
  await started; await outbox.clear(); await assert.rejects(sending);
  assert.equal(store.rows.size, 0);
  assert.equal(outbox.list().length, 0);
});

test('realtime acknowledgement wins over a late media transport error', async () => {
  const store = new MemoryMediaStore(); const outbox = new ChatMediaOutbox('alice', { store }); const row = await enqueue(outbox);
  await assert.rejects(outbox.send(row, async () => { await outbox.acknowledge(row.client_id); throw new Error('late error'); }));
  assert.equal(store.rows.size, 0);
  assert.equal(outbox.list().length, 0);
});

test('unavailable durable storage rejects before any transfer is attempted', async () => {
  const outbox = new ChatMediaOutbox('alice', { store: { epoch: async () => { throw new Error('CHAT_MEDIA_STORAGE_UNAVAILABLE'); } } });
  await assert.rejects(enqueue(outbox), /STORAGE_UNAVAILABLE/);
  assert.equal(outbox.list().length, 0);
});
