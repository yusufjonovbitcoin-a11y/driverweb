import assert from 'node:assert/strict';
import test from 'node:test';
import { driverPresenceFields, updateDriverPresence, expireDriverPresence } from './driverPresenceModel.js';

const now = Date.parse('2026-10-03T12:00:00Z');
const presence = { is_online: true, last_seen_at: '2026-10-03T11:59:50Z', latitude: 0, longitude: -96.8 };

test('presence updates preserve unrelated driver and assignment fields', () => {
  const drivers = [{ id: 'one', truck: '147', avatar: 'avatar' }, { id: 'two' }];
  const result = updateDriverPresence(drivers, 'one', presence, now);
  assert.equal(result[0].truck, '147');
  assert.equal(result[0].avatar, 'avatar');
  assert.equal(result[0].isOnline, true);
  assert.equal(result[0].lat, 0);
  assert.equal(result[1], drivers[1]);
  assert.equal(updateDriverPresence(result, 'one', presence, now), result);
  assert.equal(updateDriverPresence(result, 'unknown', presence, now), result);
});

test('offline, stale and deleted presence never fabricate GPS', () => {
  assert.equal(driverPresenceFields(presence, now + 120_000).isOnline, false);
  assert.equal(driverPresenceFields({ ...presence, is_online: false }, now).lat, null);
  assert.equal(driverPresenceFields(null, now).lastSeenAt, null);
  assert.equal(driverPresenceFields({ ...presence, latitude: null }, now).currentLocation, null);
});

test('online driver expires locally even without any new network events', () => {
  const drivers = [{ id: 'one', ...driverPresenceFields(presence, now) }, { id: 'two', isOnline: false }];
  assert.equal(expireDriverPresence(drivers, now), drivers);
  const expired = expireDriverPresence(drivers, now + 120_000);
  assert.equal(expired[0].isOnline, false);
  assert.equal(expired[0].lat, null);
  assert.equal(expired[0].lastSeenAt, presence.last_seen_at);
  assert.equal(expired[1], drivers[1]);
});
