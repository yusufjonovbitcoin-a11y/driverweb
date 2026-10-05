import { createFormatterCache } from './formatterCache.js';

export const DEFAULT_TIME_ZONE = 'America/New_York';
// IANA zones, not fixed UTC offsets: daylight-saving changes remain automatic.
export const TIME_ZONES = [
  { value: 'America/New_York', label: 'New York — ET' },
  { value: 'America/Chicago', label: 'Chicago — CT' },
  { value: 'America/Denver', label: 'Denver — MT' },
  { value: 'America/Los_Angeles', label: 'Los Angeles — PT' },
  { value: 'America/Phoenix', label: 'Arizona — MST' },
  { value: 'America/Anchorage', label: 'Alaska — AKT' },
  { value: 'Pacific/Honolulu', label: 'Hawaii — HST' },
];
const supported = new Set(TIME_ZONES.map(zone => zone.value));
const normalize = value => supported.has(value) ? value : DEFAULT_TIME_ZONE;
const formatter = createFormatterCache((locale, options) => new Intl.DateTimeFormat(locale, options));

export function formatTimeZoneClock(date, zone) {
  return formatter('en-GB', { timeZone: normalize(zone), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function createTimeZonePreference(getStorage = () => globalThis.window?.localStorage) {
  let account = null;
  let zone = DEFAULT_TIME_ZONE;
  const listeners = new Set();
  const key = () => account ? `drivex:time-zone:v1:${encodeURIComponent(account)}` : null;
  const update = value => {
    const next = normalize(value);
    if (next === zone) return;
    zone = next;
    listeners.forEach(listener => listener());
  };
  const reload = () => {
    try { update(key() ? getStorage()?.getItem(key()) : null); }
    catch { update(null); }
  };
  return {
    getSnapshot: () => zone,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    selectAccount(id) {
      if (account === (id || null)) return;
      account = id || null;
      reload();
    },
    set(value) {
      if (!supported.has(value)) return false;
      update(value);
      try {
        const storage = getStorage();
        if (!key() || !storage) return false;
        storage.setItem(key(), value);
        return true;
      } catch { return false; }
    },
    onStorage(event) {
      try {
        if (event.storageArea === getStorage() && (event.key === null || event.key === key())) reload();
      } catch { /* Storage can be unavailable in private/restricted browsers. */ }
    },
  };
}

export const timeZonePreference = createTimeZonePreference();

export function formatDisplayDate(value, locale, options = {}) {
  if (value == null || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // Calendar-only values have no instant or timezone; never move them a day back.
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return formatter(locale, {
    timeZone: timeZonePreference.getSnapshot(), ...options,
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

export function displayDayKey(value, zone = timeZonePreference.getSnapshot()) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = formatter('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function relativeDisplayDay(value, now = new Date(), zone = timeZonePreference.getSnapshot()) {
  const today = displayDayKey(now, zone);
  const day = displayDayKey(value, zone);
  if (!today || !day) return null;
  if (day === today) return 'today';
  // Subtract a calendar day, not 24 elapsed hours across a DST transition.
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return day === previous.toISOString().slice(0, 10) ? 'yesterday' : null;
}
