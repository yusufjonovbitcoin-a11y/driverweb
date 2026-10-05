import i18n from './index';
import { localeTag } from './locales';
import { createFormatterCache } from './formatterCache.js';
import { formatStopAppointment } from './stopAppointment.js';
import { formatDisplayDate } from './timeZone.js';

const tag = () => localeTag(i18n.resolvedLanguage || i18n.language);
const numberFormatter = createFormatterCache((locale, options) => new Intl.NumberFormat(locale, options));

export function formatNumber(value, options = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return numberFormatter(tag(), options).format(Number(value));
}

export function formatCurrency(value, currency = 'USD') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return numberFormatter(tag(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatDate(value, options = {}) {
  return formatDisplayDate(value, tag(), options);
}

export function formatDateTime(value, options = {}) {
  return formatDate(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  });
}

export function formatTime(value, options = {}) {
  return formatDate(value, { hour: '2-digit', minute: '2-digit', ...options });
}

export function formatAppointment(value, timeZone, options = {}) {
  return formatStopAppointment(value, timeZone, tag(), options);
}
