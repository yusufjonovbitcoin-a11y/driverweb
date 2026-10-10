import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserNotificationReceiver } from './browserNotificationReceiver.js';

const now = Date.parse('2026-10-07T12:00:00Z');
const notification = { id: 'n1', recipient_id: 'u1', type: 'chat_message', entity_type: 'chat_conversation', entity_id: 'c1', chat_message_id: 'm1', created_at: new Date(now).toISOString(), title: 'Private sender', body: 'Private text' };
const call = { id: 'call1', recipient_id: 'u1', status: 'ringing', initiator_id: 'u2', conversation_id: 'c1', started_at: new Date(now).toISOString() };
function fixture(overrides = {}) {
  const shown = [], closed = [];
  const receiver = createBrowserNotificationReceiver({
    userId: 'u1', now: () => now,
    send: async value => { shown.push(value); return true; },
    closeCall: async id => { closed.push(id); }, resolveCaller: async () => 'John', ...overrides,
  });
  return { ...receiver, shown, closed };
}

test('messages use common FCM IDs and never copy private message text', async () => {
  const f = fixture();
  await f.onNotification(notification);
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].data.notificationId, 'n1');
  assert.equal(f.shown[0].data.chatMessageId, 'm1');
  assert.equal(f.shown[0].data.recipient_id, 'u1');
  assert.equal(JSON.stringify(f.shown).includes('Private'), false);
});
test('does not notify another account, read, deleted, non-chat or old messages', async () => {
  const f = fixture();
  for (const change of [
    { recipient_id: 'u2' }, { read_at: new Date(now).toISOString() },
    { chat_message: { read_at: new Date(now).toISOString() } }, { chat_message: { deleted_at: new Date(now).toISOString() } },
    { type: 'chat_message_deleted' }, { entity_type: 'broker_message' },
    { created_at: new Date(now - 301_000).toISOString() }, { created_at: 'invalid' },
    { created_at: new Date(now + 120_000).toISOString() },
  ]) await f.onNotification({ ...notification, ...change });
  assert.equal(f.shown.length, 0);
});
test('realtime and reconnect messages dedupe, failed bridge can retry', async () => {
  let attempts = 0;
  const f = fixture({ send: async () => { attempts++; if (attempts === 1) throw new Error('worker starting'); return true; } });
  await f.onNotification(notification);
  await Promise.all([f.onNotification(notification), f.onNotification(notification)]);
  assert.equal(attempts, 2);
});
test('notifications rejected by worker can retry after permission is ready', async () => {
  let attempts = 0;
  const f = fixture({ send: async () => ++attempts !== 1 });
  await f.onNotification(notification); await f.onNotification(notification);
  assert.equal(attempts, 2);
});
test('incoming call has name, recipient, fixed expiry and dedupes', async () => {
  const f = fixture();
  await f.onCall(call); await f.onCall(call);
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].data.caller_name, 'John');
  assert.equal(f.shown[0].data.expires_at, new Date(now + 90_000).toISOString());
  assert.equal(f.shown[0].data.recipient_id, 'u1');
});
test('ended or accepted call closes notification and cannot revive', async () => {
  const f = fixture();
  await f.onCall({ ...call, status: 'accepted' }); await f.onCall(call);
  assert.deepEqual(f.closed, ['call1']); assert.equal(f.shown.length, 0);
});
test('call answered during slow name lookup never rings', async () => {
  let resolve;
  const f = fixture({ resolveCaller: () => new Promise(done => { resolve = done; }) });
  const pending = f.onCall(call);
  await f.onCall({ ...call, status: 'ended' }); resolve('John'); await pending;
  assert.equal(f.shown.length, 0); assert.deepEqual(f.closed, ['call1']);
});
test('account disposal cancels pending lookup and later events', async () => {
  let resolve;
  const f = fixture({ resolveCaller: () => new Promise(done => { resolve = done; }) });
  const pending = f.onCall(call);
  f.dispose(); resolve('John'); await pending;
  await f.onNotification(notification); await f.onCall(call);
  assert.equal(f.shown.length, 0);
});
test('expired, malformed, future and non-recipient calls never ring', async () => {
  const f = fixture();
  for (const change of [{ recipient_id: 'u2' }, { started_at: 'bad' }, { started_at: new Date(now - 91_000).toISOString() }, { started_at: new Date(now + 120_000).toISOString() }]) {
    await f.onCall({ ...call, ...change });
  }
  assert.equal(f.shown.length, 0);
});
