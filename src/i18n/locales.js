export const SUPPORTED_LOCALES = ['uz', 'ru', 'en'];
export const LOCALE_STORAGE_KEY = 'drivex_locale';
export const LOCALE_PENDING_SYNC_KEY = 'drivex_locale_pending_sync';

export const LOCALE_META = {
  uz: { label: "O‘zbek", tag: 'uz-UZ' },
  ru: { label: 'Русский', tag: 'ru-RU' },
  en: { label: 'English', tag: 'en-US' },
};

export function normalizeLocale(value) {
  const locale = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(locale) ? locale : 'uz';
}

export function localeTag(locale) {
  return LOCALE_META[normalizeLocale(locale)].tag;
}

export function applyLocaleToEnvironment(value, { storage, documentElement } = {}) {
  const locale = normalizeLocale(value);
  const targetStorage = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const targetDocumentElement = documentElement ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (targetDocumentElement) targetDocumentElement.lang = locale;
  targetStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  return locale;
}

function targetStorage(storage) {
  return storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
}

export function persistPendingLocaleOverride(value, userId, { storage } = {}) {
  const locale = normalizeLocale(value);
  targetStorage(storage)?.setItem(LOCALE_PENDING_SYNC_KEY, JSON.stringify({ locale, userId: userId || null }));
  return locale;
}

export function clearPendingLocaleOverride(value, userId, { storage } = {}) {
  const persistedStorage = targetStorage(storage);
  if (value !== undefined) {
    try {
      const pending = JSON.parse(persistedStorage?.getItem(LOCALE_PENDING_SYNC_KEY) || 'null');
      if (
        pending?.userId !== (userId || null)
        || normalizeLocale(pending?.locale) !== normalizeLocale(value)
      ) return false;
    } catch {
      return false;
    }
  }
  persistedStorage?.removeItem(LOCALE_PENDING_SYNC_KEY);
  return true;
}

export function resolveLocaleForProfile(profileLocale, userId, { storage } = {}) {
  const persistedStorage = targetStorage(storage);
  const localLocale = persistedStorage?.getItem(LOCALE_STORAGE_KEY);
  let pendingOverride = null;
  try {
    pendingOverride = JSON.parse(persistedStorage?.getItem(LOCALE_PENDING_SYNC_KEY) || 'null');
  } catch {
    pendingOverride = null;
  }

  if (
    pendingOverride?.userId === (userId || null)
    && localLocale
    && normalizeLocale(pendingOverride.locale) === normalizeLocale(localLocale)
  ) {
    return normalizeLocale(localLocale);
  }
  return normalizeLocale(profileLocale || localLocale);
}
