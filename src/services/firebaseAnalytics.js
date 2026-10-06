import { firebaseConfig, getFirebaseApp } from './firebaseConfig.js';
import { ANALYTICS_PREFERENCE, analyticsAllowed, analyticsPage } from './analyticsPolicy.js';

let analyticsPromise;
let lastPage = '';
export function analyticsEnabled() {
  if (!firebaseConfig.apiKey) return false;
  try {
    return analyticsAllowed({ production: import.meta.env.PROD, hostname: location.hostname,
      preference: localStorage.getItem(ANALYTICS_PREFERENCE), doNotTrack: navigator.doNotTrack,
      globalPrivacyControl: navigator.globalPrivacyControl });
  } catch { return false; }
}
export function analyticsPreference() {
  try { return localStorage.getItem(ANALYTICS_PREFERENCE) !== 'false'; } catch { return false; }
}
export async function setAnalyticsPreference(enabled) {
  localStorage.setItem(ANALYTICS_PREFERENCE, String(enabled));
  await syncAnalyticsPrivacy();
}
export async function syncAnalyticsPrivacy() {
  window[`ga-disable-${firebaseConfig.measurementId}`] = !analyticsEnabled();
  lastPage = '';
  if (analyticsPromise) {
    const loaded = await analyticsPromise;
    loaded?.sdk.setAnalyticsCollectionEnabled(loaded.instance, analyticsEnabled());
    if (!loaded) analyticsPromise = undefined;
  }
}
async function loadAnalytics() {
  if (!analyticsEnabled()) return null;
  analyticsPromise ??= (async () => {
    const sdk = await import('firebase/analytics');
    if (!await sdk.isSupported() || !analyticsEnabled()) return null;
    // Only anonymous route metrics; no account IDs, chat text, document titles or URL queries.
    sdk.setConsent({ analytics_storage: 'granted', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied' });
    const instance = sdk.initializeAnalytics(await getFirebaseApp(), { config: {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: `${location.origin}/`, page_referrer: '', page_title: 'T Fleest',
    } });
    return { sdk, instance };
  })().catch(() => { analyticsPromise = undefined; return null; });
  return analyticsPromise;
}
export async function trackPage(tab) {
  if (!analyticsEnabled()) return;
  const page = analyticsPage(tab, location.origin);
  const loaded = await loadAnalytics();
  if (!loaded || !analyticsEnabled() || lastPage === page.page_location) return;
  lastPage = page.page_location;
  loaded.sdk.logEvent(loaded.instance, 'page_view', page);
}
