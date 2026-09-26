import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uz from './resources/uz.json';
import ru from './resources/ru.json';
import en from './resources/en.json';
import { applyLocaleToEnvironment, LOCALE_STORAGE_KEY, normalizeLocale } from './locales';

function initialLocale() {
  if (typeof window === 'undefined') return 'uz';
  return normalizeLocale(
    window.localStorage.getItem(LOCALE_STORAGE_KEY) || window.navigator.language,
  );
}

await i18n.use(initReactI18next).init({
  resources: {
    uz: { translation: uz },
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: initialLocale(),
  fallbackLng: 'uz',
  supportedLngs: ['uz', 'ru', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export async function setAppLocale(value, { persist = true } = {}) {
  const locale = normalizeLocale(value);
  await i18n.changeLanguage(locale);
  if (persist) applyLocaleToEnvironment(locale);
  else if (typeof document !== 'undefined') document.documentElement.lang = locale;
  return locale;
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = normalizeLocale(i18n.resolvedLanguage || i18n.language);
}

export default i18n;
