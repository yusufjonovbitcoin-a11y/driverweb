import assert from 'node:assert/strict';
import test from 'node:test';
import { createFormatterCache } from './formatterCache.js';

test('equivalent fresh option objects reuse one formatter across table cells', () => {
  let constructed = 0;
  const get = createFormatterCache((locale, options) => {
    constructed += 1;
    return new Intl.NumberFormat(locale, options);
  });
  const first = get('en-US', { style: 'currency', currency: 'USD' });
  for (let index = 0; index < 100; index += 1) {
    assert.equal(get('en-US', { currency: 'USD', minimumFractionDigits: undefined, style: 'currency' }), first);
  }
  assert.equal(constructed, 1);
  assert.equal(first.format(1250.25), '$1,250.25');
});

test('locale, currency and time zone switches never reuse incompatible formatters', () => {
  const number = createFormatterCache((locale, options) => new Intl.NumberFormat(locale, options));
  const options = { style: 'currency', currency: 'USD' };
  assert.notEqual(number('en-US', options), number('ru-RU', options));
  assert.notEqual(number('en-US', options), number('en-US', { ...options, currency: 'EUR' }));
  const date = createFormatterCache((locale, options) => new Intl.DateTimeFormat(locale, options));
  const instant = new Date('2026-10-03T01:00:00Z');
  assert.notEqual(date('en-US', { timeZone: 'UTC' }).format(instant), date('en-US', { timeZone: 'America/Los_Angeles' }).format(instant));
});

test('bounded cache evicts least recently used configuration without changing formatting', () => {
  const get = createFormatterCache((locale, options) => new Intl.NumberFormat(locale, options), 2);
  const english = get('en-US');
  const russian = get('ru-RU');
  assert.equal(get('en-US'), english);
  get('uz-UZ');
  assert.equal(get('en-US'), english);
  const refreshedRussian = get('ru-RU');
  assert.notEqual(refreshedRussian, russian);
  assert.equal(refreshedRussian.format(1234.5), russian.format(1234.5));
});
