import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, calendarDays, calendarRange, formatCalendarDay, shiftCalendarDay, shiftCalendarMonth, validCalendarDay } from './calendarModel.js';
test('date-only grid matches its month and Monday-first weekdays without timezone shifts', () => {
  const days = calendarDays('2026-10-01');
  assert.deepEqual(days.slice(0, 4), [null, null, null, '2026-10-01']);
  assert.equal(days.at(-1), '2026-10-31');
  assert.equal(formatCalendarDay('2026-10-01', 'en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' }), 'October 2026');
  assert.equal(formatCalendarDay('2026-10-01', 'en-US', { weekday: 'long' }), 'Thursday');
});
test('leap years and month/year keyboard transitions preserve valid dates', () => {
  assert.equal(calendarDays('2024-02-01').filter(Boolean).length, 29);
  assert.equal(calendarDays('2026-02-01').filter(Boolean).length, 28);
  assert.equal(shiftCalendarMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftCalendarMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftCalendarDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftCalendarMonth('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftCalendarDay('0001-01-01', -1), '0001-01-01');
  assert.equal(shiftCalendarDay('9999-12-31', 1), '9999-12-31');
  assert.equal(shiftCalendarMonth('9999-12-01', 1), '9999-12-31');
  assert.equal(calendarDate('0000-01-01'), null);
});
test('reversed ranges normalize and date bounds reject impossible dates', () => {
  assert.deepEqual(calendarRange('2026-10-20', '2026-10-10'), { from: '2026-10-10', to: '2026-10-20' });
  assert.equal(calendarDate('2026-02-31'), null);
  assert.equal(calendarDate('2026-13-01'), null);
  assert.equal(validCalendarDay('2026-10-10', '2026-10-11', '2026-10-20'), false);
  assert.equal(validCalendarDay('2026-10-20', '2026-10-11', '2026-10-20'), true);
  assert.equal(validCalendarDay('2026-10-21', '2026-10-11', '2026-10-20'), false);
});
