import i18n from './index';
import { localeTag } from './locales';

const tag = () => localeTag(i18n.resolvedLanguage || i18n.language);

export function formatNumber(value, options = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(tag(), options).format(Number(value));
}

export function formatCurrency(value, currency = 'USD') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(tag(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(tag(), options).format(date);
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
