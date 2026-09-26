import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatCursor,
  buildIceServers,
  mergeChatMessages,
} from './chatReliability.js';

const message = (id, createdAt, extra = {}) => ({
  id,
  created_at: createdAt,
  deleted_at: null,
  ...extra,
});

test('mergeChatMessages keeps chronological order and applies newer rows', () => {
  const current = [
    message('b', '2026-09-26T10:00:02.000Z', { body: 'old' }),
    message('a', '2026-09-26T10:00:01.000Z'),
  ];
  const incoming = [
    message('b', '2026-09-26T10:00:02.000Z', { body: 'updated' }),
    message('c', '2026-09-26T10:00:03.000Z'),
  ];

  assert.deepEqual(
    mergeChatMessages(current, incoming).map(({ id, body }) => [id, body]),
    [['a', undefined], ['b', 'updated'], ['c', undefined]],
  );
});

test('mergeChatMessages removes soft-deleted rows', () => {
  const current = [message('a', '2026-09-26T10:00:01.000Z')];
  const incoming = [message('a', '2026-09-26T10:00:01.000Z', { deleted_at: '2026-09-26T10:01:00.000Z' })];

  assert.deepEqual(mergeChatMessages(current, incoming), []);
});

test('buildChatCursor returns the oldest row as a stable composite cursor', () => {
  const cursor = buildChatCursor([
    message('b', '2026-09-26T10:00:02.000Z'),
    message('a', '2026-09-26T10:00:01.000Z'),
  ]);

  assert.deepEqual(cursor, {
    createdAt: '2026-09-26T10:00:01.000Z',
    id: 'a',
  });
});

test('buildIceServers adds configured TURN and keeps STUN fallback', () => {
  const servers = buildIceServers({
    turnUrls: 'turn:turn.example.com:3478,turns:turn.example.com:5349',
    turnUsername: 'driver',
    turnCredential: 'secret',
  });

  assert.equal(servers.length, 3);
  assert.deepEqual(servers[2], {
    urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349'],
    username: 'driver',
    credential: 'secret',
  });
});

test('buildIceServers never emits a partial TURN credential', () => {
  const servers = buildIceServers({ turnUrls: 'turn:turn.example.com:3478' });
  assert.equal(servers.length, 2);
});
