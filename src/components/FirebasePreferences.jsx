import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { analyticsEnabled, analyticsPreference, setAnalyticsPreference, trackPage } from '../services/firebaseAnalytics';

export default function FirebasePreferences({ browserPush }) {
  const { t } = useTranslation();
  const [analytics, setAnalytics] = useState(analyticsPreference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const status = browserPush?.status || 'unsupported';
  return <section className="profile-panel space-y-5">
    <div className="space-y-3">
      <h3>{t('firebase.browserPush')}</h3>
      <p>{t('firebase.pushDescription')}</p>
      <p role="status" aria-live="polite">{t(`firebase.${browserPush?.busy ? 'working' : status}`)}</p>
      <button type="button" className="rounded-xl bg-teal-700 px-4 py-2.5 font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={!browserPush || browserPush.busy || ['unsupported', 'denied'].includes(status)} onClick={browserPush?.toggle}>
        {t(status === 'on' ? 'firebase.disable' : 'firebase.enable')}
      </button>
    </div>
    <div className="space-y-3 border-t border-[var(--border-color)] pt-5">
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={analytics} disabled={saving} onChange={async (event) => {
          const enabled = event.target.checked;
          setSaving(true); setError(false);
          try { await setAnalyticsPreference(enabled); setAnalytics(enabled); if (enabled) void trackPage('profile'); }
          catch { setError(true); }
          finally { setSaving(false); }
        }} />
        <strong>{t('firebase.analytics')}</strong>
      </label>
      <p>{t('firebase.analyticsDescription')}</p>
      {!analyticsEnabled() && analytics && <p className="profile-panel-note">{t('firebase.analyticsInactive')}</p>}
      {error && <p role="alert">{t('firebase.error')}</p>}
    </div>
  </section>;
}
