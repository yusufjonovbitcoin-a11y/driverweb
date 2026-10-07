import test from 'node:test';
import assert from 'node:assert/strict';
import { driverPresenceFields, refreshDriverPresence, mergePresenceSnapshot } from './driverPresence.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const presence = { driver_id: 'a', last_seen_at: new Date(now).toISOString(), location_captured_at: new Date(now).toISOString(), is_online: true, latitude: 0, longitude: -73 };
test('online expires without a server write; zero coordinates remain valid', () => {
  const driver = { id: 'a', name: 'Keep this driver', ...driverPresenceFields(presence, now) };
  assert.equal(driver.isOnline, true); assert.equal(driver.lat, 0);
  const [expired] = refreshDriverPresence([driver], null, now + 120_000);
  assert.equal(expired.isOnline, false); assert.equal(expired.lat, null);
  assert.equal(expired.name, driver.name); assert.equal(expired.lastSeenAt, presence.last_seen_at);
});
test('old HTTP response cannot overwrite fresh realtime presence', () => {
  const driver = { id: 'a', ...driverPresenceFields(presence, now) };
  const stale = { ...presence, last_seen_at: new Date(now - 180_000).toISOString() };
  assert.equal(refreshDriverPresence([driver], new Map([['a', stale]]), now)[0].isOnline, true);
});
test('explicit offline/deleted presence expires marker without removing driver', () => {
  const driver = { id: 'a', name: 'Driver', ...driverPresenceFields(presence, now) };
  const result = refreshDriverPresence([driver], new Map([['a', null]]), now);
  assert.equal(result.length, 1); assert.equal(result[0].name, 'Driver'); assert.equal(result[0].isOnline, false);
});
test('invalid/far future timestamps never create live status', () => {
  assert.equal(driverPresenceFields({ ...presence, last_seen_at: 'bad' }, now).isOnline, false);
  assert.equal(driverPresenceFields(presence, now - 60_000).isOnline, false);
});
test('newer offline updated_at wins even if last_seen_at has not changed', () => {
  const offline = { ...presence, is_online: false, updated_at: new Date(now + 1000).toISOString() };
  const driver = { id: 'a', ...driverPresenceFields(offline, now + 1000) };
  const stale = { ...presence, updated_at: new Date(now).toISOString() };
  assert.equal(refreshDriverPresence([driver], new Map([['a', stale]]), now + 1000)[0].isOnline, false);
});
test('HTTP response cannot resurrect a realtime deletion or offline event', () => {
  const start = new Map([['a', presence]]);
  assert.equal(mergePresenceSnapshot(new Map([['a', null]]), start, [presence]).get('a'), null);
  const offline = { ...presence, is_online: false };
  assert.equal(mergePresenceSnapshot(new Map([['a', offline]]), start, [presence]).get('a'), offline);
});
test('reconciliation clears missing presence but does not erase drivers', () => {
  const current = new Map([['a', presence]]);
  const merged = mergePresenceSnapshot(current, new Map(current), []);
  assert.equal(merged.get('a'), null);
  assert.equal(refreshDriverPresence([{ id: 'a', name: 'Driver' }], merged, now).length, 1);
});

test('fresh heartbeat does not revive stale, missing or future GPS coordinates', () => {
  for (const capturedAt of [undefined, null, 'invalid', new Date(now - 120_000).toISOString(), new Date(now + 30_001).toISOString()]) {
    const fields = driverPresenceFields({ ...presence, location_captured_at: capturedAt }, now);
    assert.equal(fields.isOnline, true);
    assert.equal(fields.lat, null);
    assert.equal(fields.lng, null);
    assert.equal(fields.currentLocation, null);
  }
});
test('GPS expires independently while later heartbeats keep the driver online', () => {
  const later = { ...presence, last_seen_at: new Date(now + 119_000).toISOString() };
  const fields = driverPresenceFields(later, now + 120_000);
  assert.equal(fields.isOnline, true);
  assert.equal(fields.lat, null);
});
