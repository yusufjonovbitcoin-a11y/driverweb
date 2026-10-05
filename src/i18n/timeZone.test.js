import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimeZonePreference, DEFAULT_TIME_ZONE, TIME_ZONES, timeZonePreference, formatDisplayDate, displayDayKey, relativeDisplayDay } from './timeZone.js';
import { formatStopAppointment } from './stopAppointment.js';

function fixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  return { data, storage, store: createTimeZonePreference(() => storage) };
}

test('account preference persists on reload and does not leak between accounts', () => {
  const { store, storage } = fixture();
  store.selectAccount('one');
  assert.equal(store.getSnapshot(), DEFAULT_TIME_ZONE);
  assert.equal(store.set('America/Chicago'), true);
  store.selectAccount('two');
  assert.equal(store.getSnapshot(), DEFAULT_TIME_ZONE);
  store.set('America/Los_Angeles');
  store.selectAccount('one');
  assert.equal(store.getSnapshot(), 'America/Chicago');
  const reopened = createTimeZonePreference(() => storage);
  reopened.selectAccount('two');
  assert.equal(reopened.getSnapshot(), 'America/Los_Angeles');
  reopened.selectAccount(null);
  assert.equal(reopened.getSnapshot(), DEFAULT_TIME_ZONE);
});

test('invalid stored zones fall back safely; subscriptions notify only changes', () => {
  const { store, storage, data } = fixture();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.selectAccount('one');
  assert.equal(store.set('broken'), false);
  assert.equal(store.getSnapshot(), DEFAULT_TIME_ZONE);
  store.set('America/Chicago');
  store.set('America/Chicago');
  assert.equal(updates, 1);
  const key = [...data.keys()][0];
  storage.setItem(key, 'Invalid/Zone');
  store.onStorage({ key, storageArea: storage });
  assert.equal(store.getSnapshot(), DEFAULT_TIME_ZONE);
  unsubscribe();
  store.set('America/Denver');
  assert.equal(updates, 2);
});

test('another tab updates only the matching account; clearing storage restores default', () => {
  const { store, storage, data } = fixture();
  store.selectAccount('one');
  store.set('America/Chicago');
  const key = [...data.keys()][0];
  storage.setItem(key, 'America/Denver');
  store.onStorage({ key: 'unrelated', storageArea: storage });
  assert.equal(store.getSnapshot(), 'America/Chicago');
  store.onStorage({ key, storageArea: storage });
  assert.equal(store.getSnapshot(), 'America/Denver');
  data.clear();
  store.onStorage({ key: null, storageArea: storage });
  assert.equal(store.getSnapshot(), DEFAULT_TIME_ZONE);
});

test('blocked storage still applies a session preference and reports not saved', () => {
  const store = createTimeZonePreference(() => { throw Error('denied'); });
  store.selectAccount('one');
  assert.equal(store.set('America/Phoenix'), false);
  assert.equal(store.getSnapshot(), 'America/Phoenix');
});

test('all offered zones are supported by Intl', () => {
  for (const { value } of TIME_ZONES) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: value }));
});

test('display timestamps follow chosen zone; date-only and stop appointments stay unchanged', () => {
  const appointment = formatStopAppointment('2026-10-05T00:30:00Z', 'America/Chicago');
  const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  timeZonePreference.set('America/New_York');
  assert.equal(formatDisplayDate('2026-10-05T00:30:00Z', 'en-US', options), '20:30');
  timeZonePreference.set('America/Los_Angeles');
  assert.equal(formatDisplayDate('2026-10-05T00:30:00Z', 'en-US', options), '17:30');
  assert.equal(formatDisplayDate('2026-10-05', 'en-US', { day: 'numeric' }), '5');
  assert.equal(formatDisplayDate(null, 'en-US'), '—');
  assert.equal(formatDisplayDate('bad-date', 'en-US'), '—');
  assert.equal(formatStopAppointment('2026-10-05T00:30:00Z', 'America/Chicago'), appointment);
  timeZonePreference.set(DEFAULT_TIME_ZONE);
});

test('ET daylight saving changes automatically, Arizona has no seasonal jump', () => {
  const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  timeZonePreference.set('America/New_York');
  assert.equal(formatDisplayDate('2026-01-05T12:00:00Z', 'en-US', options), '07:00');
  assert.equal(formatDisplayDate('2026-07-05T12:00:00Z', 'en-US', options), '08:00');
  timeZonePreference.set('America/Phoenix');
  for (const month of ['01', '07']) assert.equal(formatDisplayDate(`2026-${month}-05T12:00:00Z`, 'en-US', options), '05:00');
  timeZonePreference.set(DEFAULT_TIME_ZONE);
});

test('chat day separators use selected zone near midnight', () => {
  const value = '2026-10-05T05:30:00Z';
  assert.equal(displayDayKey(value, 'America/New_York'), '2026-10-05');
  assert.equal(displayDayKey(value, 'America/Los_Angeles'), '2026-10-04');
  assert.equal(relativeDisplayDay(value, new Date('2026-10-05T08:00:00Z'), 'America/Los_Angeles'), 'yesterday');
  assert.equal(relativeDisplayDay(value, new Date('2026-10-05T08:00:00Z'), 'America/New_York'), 'today');
});

test('yesterday remains a calendar day across spring/fall DST and year boundary', () => {
  assert.equal(relativeDisplayDay('2026-03-08T06:00:00Z', new Date('2026-03-09T04:30:00Z'), 'America/New_York'), 'yesterday');
  assert.equal(relativeDisplayDay('2026-10-31T16:00:00Z', new Date('2026-11-02T04:30:00Z'), 'America/New_York'), 'yesterday');
  assert.equal(relativeDisplayDay('2026-12-31T20:00:00Z', new Date('2027-01-01T10:00:00Z'), 'America/New_York'), 'yesterday');
});
