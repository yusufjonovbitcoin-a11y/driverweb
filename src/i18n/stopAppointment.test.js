import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStopAppointment, stopCalendarDate } from './stopAppointment.js';

test('stop timezone overrides dispatcher/device zone and includes the zone', () => {
  const text = formatStopAppointment('2026-10-05T13:00:00Z', 'America/New_York', 'en-US', { timeOnly: true });
  assert.match(text, /09:00 AM EDT/);
  assert.match(text, /America\/New_York/);
  assert.match(formatStopAppointment('2026-10-05T13:00:00Z', 'America/Los_Angeles', 'en-US'), /06:00 AM PDT/);
});

test('IANA rules apply daylight saving and Arizona exception', () => {
  assert.match(formatStopAppointment('2026-01-05T14:00:00Z', 'America/New_York'), /09:00 AM EST/);
  assert.match(formatStopAppointment('2026-07-05T13:00:00Z', 'America/New_York'), /09:00 AM EDT/);
  assert.match(formatStopAppointment('2026-07-05T16:00:00Z', 'America/Phoenix'), /09:00 AM MST/);
});

test('printed dates and wall-clock values are preserved, not shifted', () => {
  assert.equal(formatStopAppointment('2026-10-05', 'America/New_York'), '2026-10-05 · America/New_York');
  assert.equal(formatStopAppointment('2026-10-05 09:00', 'America/New_York'), '2026-10-05 09:00 · America/New_York');
  assert.equal(formatStopAppointment('OCT 05, 2026 09:00 - 14:00', null), 'OCT 05, 2026 09:00 - 14:00');
});

test('unknown/invalid stop timezone uses explicitly labelled UTC for instants only', () => {
  for (const zone of [null, '', 'not/a-zone']) {
    const text = formatStopAppointment('2026-10-05T09:00:00-04:00', zone);
    assert.match(text, /01:00 PM UTC/);
    assert.equal(formatStopAppointment('09:00', zone), '09:00');
  }
  assert.equal(formatStopAppointment(null, 'America/New_York'), '—');
  assert.equal(formatStopAppointment(new Date('invalid'), 'America/New_York'), '—');
});

test('board calendar date/filter follow stop day across UTC midnight without shifting date-only values', () => {
  const instant = '2026-10-06T02:00:00Z';
  assert.equal(stopCalendarDate(instant, 'America/New_York'), '2026-10-05');
  assert.match(formatStopAppointment(instant, 'America/New_York', 'en-US', { dateOnly: true }), /Oct 5, 2026/);
  assert.equal(stopCalendarDate('2026-10-05', 'America/Los_Angeles'), '2026-10-05');
  assert.equal(stopCalendarDate('2026-10-05 09:00', 'America/Los_Angeles'), '2026-10-05');
  assert.equal(stopCalendarDate('not a date', 'America/New_York'), null);
  assert.equal(stopCalendarDate(instant, null), '2026-10-06');
});
