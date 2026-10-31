// Date-only values are calendar days, not UTC instants in the display timezone.
export function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.toISOString().slice(0, 10) === value ? date : null;
}
export const calendarKey = date => date.toISOString().slice(0, 10);
export const calendarMonth = day => day.slice(0, 7) + '-01';
export function shiftCalendarDay(day, offset) {
  const date = calendarDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  if (date.getUTCFullYear() < 1) return '0001-01-01';
  if (date.getUTCFullYear() > 9999) return '9999-12-31';
  return calendarKey(date);
}
export function shiftCalendarMonth(day, offset) {
  const date = calendarDate(day), number = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + offset);
  if (date.getUTCFullYear() < 1) return '0001-01-01';
  if (date.getUTCFullYear() > 9999) return '9999-12-31';
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(number, last));
  return calendarKey(date);
}
export function calendarDays(month) {
  const date = calendarDate(month), year = date.getUTCFullYear(), index = date.getUTCMonth();
  const offset = (date.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => `${month.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`)];
}
export function calendarRange(from, to) { return from > to ? { from: to, to: from } : { from, to }; }
export function validCalendarDay(day, min, max) { return Boolean(calendarDate(day) && (!min || day >= min) && (!max || day <= max)); }
export function formatCalendarDay(day, locale, options = {}) {
  const date = calendarDate(day);
  return date ? new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date) : '';
}
