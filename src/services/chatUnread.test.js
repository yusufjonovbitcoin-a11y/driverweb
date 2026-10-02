import test from 'node:test';
import assert from 'node:assert/strict';
import { clearUnreadForDriver, countUnreadChatsByDriver } from './chatUnread.js';

test('counts only unread incoming messages for each driver', () => {
  const counts = countUnreadChatsByDriver([
    {
      driver_id: 'driver-a',
      chat_messages: [
        { sender_id: 'driver-a', read_at: null, deleted_at: null },
        { sender_id: 'driver-a', read_at: null, deleted_at: null },
        { sender_id: 'dispatcher', read_at: null, deleted_at: null },
        { sender_id: 'driver-a', read_at: '2026-10-01T00:00:00Z', deleted_at: null },
      ],
    },
    {
      driver_id: 'driver-b',
      chat_messages: [
        { sender_id: 'driver-b', read_at: null, deleted_at: '2026-10-01T00:00:00Z' },
      ],
    },
  ], 'dispatcher');

  assert.deepEqual(counts, { 'driver-a': 2 });
});

test('clears one driver without changing other unread counts', () => {
  assert.deepEqual(
    clearUnreadForDriver({ 'driver-a': 2, 'driver-b': 1 }, 'driver-a'),
    { 'driver-b': 1 },
  );
});
