import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatSearchScope, createChatSubscription } from './chatSubscription.js';

const transport = () => {
  const handlers = {}; let status;
  const channel = { on(_, filter, callback) { handlers[filter.event] = callback; return this; }, subscribe(callback) { status = callback; return this; } };
  return { client: { channel: () => channel, removeChannel: () => {} }, event: (name, row) => handlers[name]({ new: row }), status: (value) => status(value) };
};

test('first successful subscription after an initial error performs catch-up', async () => {
  const fake = transport(); let catchups = 0;
  const subscription = createChatSubscription(fake.client, { conversationId: 'chat', onReconnect: () => catchups++ });
  const failed = assert.rejects(subscription.ready);
  fake.status('CHANNEL_ERROR'); await failed;
  fake.status('SUBSCRIBED'); fake.status('SUBSCRIBED');
  assert.equal(catchups, 1);
  fake.status('TIMED_OUT'); fake.status('SUBSCRIBED');
  assert.equal(catchups, 2);
});

test('metadata events preserve delivery order without waiting for media URLs', async () => {
  const fake = transport(); const received = [];
  const subscription = createChatSubscription(fake.client, { conversationId: 'chat', onMessage: (row) => received.push(row), onMessageUpdated: (row) => received.push(row) });
  fake.status('SUBSCRIBED'); await subscription.ready;
  fake.event('INSERT', { id: 'media', storage_path: 'some-private-file' });
  fake.event('UPDATE', { id: 'media', deleted_at: 'now' });
  assert.deepEqual(received.map((row) => row.deleted_at || 'insert'), ['insert', 'now']);
  subscription.unsubscribe(); fake.event('INSERT', { id: 'stale' });
  assert.equal(received.length, 2);
});

test('search changes and closing search invalidate old pagination, including A-B-A', () => {
  const scope = new ChatSearchScope();
  scope.select('chat:apple'); const oldApple = scope.capture();
  scope.select('chat:banana'); const banana = scope.capture();
  scope.select('chat:apple'); const newApple = scope.capture();
  assert.equal(oldApple(), false); assert.equal(banana(), false); assert.equal(newApple(), true);
  scope.select('chat:closed'); assert.equal(newApple(), false);
});
