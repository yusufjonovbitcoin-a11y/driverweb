// Only offset-bearing timestamps represent instants. Printed wall-clock/date
// values must not be interpreted in the dispatcher's browser timezone.
export function validAppointmentTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch { return null; }
}

export function formatStopAppointment(value, timeZone, locale = 'en-US', { timeOnly = false, dateOnly = false } = {}) {
  if (value == null || value === '') return '—';
  if (value instanceof Date && Number.isNaN(value.getTime())) return '—';
  const zone = validAppointmentTimeZone(timeZone);
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  if (!(value instanceof Date) && !/[T\s]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return zone ? `${text} · ${zone}` : text;
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return text;
  // UTC is an explicit fallback for a known instant, never a guessed US zone.
  const displayZone = zone || 'UTC';
  const formatted = new Intl.DateTimeFormat(locale, {
    ...(!timeOnly ? { year: 'numeric', month: 'short', day: 'numeric' } : {}),
    ...(!dateOnly ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {}), timeZone: displayZone,
  }).format(instant);
  return displayZone === 'UTC' && !dateOnly ? formatted : `${formatted} · ${displayZone}`;
}

// Calendar filters must compare the same local date that the card displays.
export function stopCalendarDate(value, timeZone) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/[T\s]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(text) ? text.slice(0, 10) : null;
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: validAppointmentTimeZone(timeZone) || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
