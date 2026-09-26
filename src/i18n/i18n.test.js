import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import i18next from 'i18next';
import {
  applyLocaleToEnvironment,
  clearPendingLocaleOverride,
  LOCALE_PENDING_SYNC_KEY,
  LOCALE_STORAGE_KEY,
  localeTag,
  normalizeLocale,
  persistPendingLocaleOverride,
  resolveLocaleForProfile,
} from './locales.js';
import { changeLocaleWithProfileSync } from './localeSync.js';
import { warningLabel } from './labels.js';

const readCatalog = async (locale) => JSON.parse(await readFile(new URL(`./resources/${locale}.json`, import.meta.url), 'utf8'));

function flatten(value, prefix = '', output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, fullKey, output);
    else output.set(fullKey, child);
  }
  return output;
}

test('locale normalization accepts supported regional forms and falls back to Uzbek', () => {
  assert.equal(normalizeLocale('ru-RU'), 'ru');
  assert.equal(normalizeLocale('EN_us'), 'en');
  assert.equal(normalizeLocale('de-DE'), 'uz');
  assert.equal(localeTag('ru'), 'ru-RU');
});

test('all catalogs contain the same keys and value types', async () => {
  const [uz, ru, en] = await Promise.all(['uz', 'ru', 'en'].map(readCatalog));
  const catalogs = [flatten(uz), flatten(ru), flatten(en)];
  const keys = [...catalogs[0].keys()].sort();
  for (const catalog of catalogs.slice(1)) {
    assert.deepEqual([...catalog.keys()].sort(), keys);
    for (const key of keys) assert.equal(Array.isArray(catalog.get(key)), Array.isArray(catalogs[0].get(key)), key);
  }
});

test('core navigation and error copy is translated in every language', async () => {
  const catalogs = await Promise.all(['uz', 'ru', 'en'].map(async (locale) => flatten(await readCatalog(locale))));
  for (const key of ['nav.loads', 'profile.language', 'errors.network', 'chat.connectionLost']) {
    const values = catalogs.map((catalog) => catalog.get(key));
    assert.ok(values.every((value) => typeof value === 'string' && value.length > 0), key);
    assert.equal(new Set(values).size, 3, `${key} should have distinct translations`);
  }
});

test('switching locale changes visible Chat and Create Load copy', async () => {
  const [uz, ru, en] = await Promise.all(['uz', 'ru', 'en'].map(readCatalog));
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'uz',
    fallbackLng: 'uz',
    resources: { uz: { translation: uz }, ru: { translation: ru }, en: { translation: en } },
  });
  assert.equal(instance.t('chat.loadOlder'), 'Eski xabarlarni yuklash');
  assert.equal(instance.t('loads.selectAll'), 'Barchasini tanlash');
  await instance.changeLanguage('en');
  assert.equal(instance.t('chat.loadOlder'), 'Load earlier messages');
  assert.equal(instance.t('loads.selectAll'), 'Select all');
  await instance.changeLanguage('ru');
  assert.equal(instance.t('chat.incomingCall'), 'Входящий звонок');
});

test('locale environment updates HTML lang and local storage', () => {
  const writes = [];
  const documentElement = { lang: '' };
  const storage = { setItem: (key, value) => writes.push([key, value]) };
  assert.equal(applyLocaleToEnvironment('en-US', { storage, documentElement }), 'en');
  assert.equal(documentElement.lang, 'en');
  assert.deepEqual(writes, [[LOCALE_STORAGE_KEY, 'en']]);
});

test('profile sync failure keeps the locally applied locale and resolves safely', async () => {
  const applied = [];
  const failures = [];
  const result = await changeLocaleWithProfileSync('ru', {
    applyLocale: async (locale) => { applied.push(locale); return locale; },
    syncLocale: async () => { throw new Error('RPC unavailable'); },
    onSyncFailed: (error) => failures.push(error.message),
  });
  assert.deepEqual(result, { locale: 'ru', synced: false });
  assert.deepEqual(applied, ['ru']);
  assert.deepEqual(failures, ['RPC unavailable']);
});

test('failed profile sync survives reload and stale profile hydration', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const userId = 'user-1';

  const result = await changeLocaleWithProfileSync('ru', {
    applyLocale: async (locale) => applyLocaleToEnvironment(locale, {
      storage,
      documentElement: { lang: '' },
    }),
    syncLocale: async () => { throw new Error('offline'); },
    markPending: (locale) => persistPendingLocaleOverride(locale, userId, { storage }),
    clearPending: (locale) => clearPendingLocaleOverride(locale, userId, { storage }),
  });

  assert.equal(result.synced, false);
  assert.equal(resolveLocaleForProfile('uz', userId, { storage }), 'ru');
  assert.ok(storage.getItem(LOCALE_PENDING_SYNC_KEY));

  const synced = await changeLocaleWithProfileSync('en', {
    applyLocale: async (locale) => applyLocaleToEnvironment(locale, {
      storage,
      documentElement: { lang: '' },
    }),
    syncLocale: async () => {},
    markPending: (locale) => persistPendingLocaleOverride(locale, userId, { storage }),
    clearPending: (locale) => clearPendingLocaleOverride(locale, userId, { storage }),
  });
  assert.equal(synced.synced, true);
  assert.equal(storage.getItem(LOCALE_PENDING_SYNC_KEY), null);
});

test('pending locale override is scoped to the authenticated user', () => {
  const values = new Map([[LOCALE_STORAGE_KEY, 'ru']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  persistPendingLocaleOverride('ru', 'user-1', { storage });
  assert.equal(resolveLocaleForProfile('uz', 'user-2', { storage }), 'uz');
  assert.equal(clearPendingLocaleOverride('en', 'user-1', { storage }), false);
  assert.ok(storage.getItem(LOCALE_PENDING_SYNC_KEY));
});

test('document warnings use semantic codes and never expose provider messages', async () => {
  const [uz, ru, en] = await Promise.all(['uz', 'ru', 'en'].map(readCatalog));
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'en',
    fallbackLng: 'uz',
    resources: { uz: { translation: uz }, ru: { translation: ru }, en: { translation: en } },
  });

  assert.equal(
    warningLabel(instance.t.bind(instance), {
      code: 'ai_missing_field',
      field: 'brokerRate',
      message: 'RAW PROVIDER MESSAGE',
    }),
    'AI could not identify Rate with confidence in the document.',
  );
  assert.equal(
    warningLabel(instance.t.bind(instance), {
      code: 'provider_specific_code',
      message: 'RAW PROVIDER MESSAGE',
    }),
    'The document contains information that needs review.',
  );
});
