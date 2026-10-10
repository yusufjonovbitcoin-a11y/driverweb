import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { analyticsEnabled, analyticsPreference, setAnalyticsPreference, trackPage } from '../services/firebaseAnalytics';

export default function FirebasePreferences({ browserPush }) {
  const { t } = useTranslation();
  const [analytics, setAnalytics] = useState(analyticsPreference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const status = browserPush?.status || 'unsupported';
  const unavailable = ['unsupported', 'denied'].includes(status);
  const hasSavedCategory = browserPush?.preferences?.calls || browserPush?.preferences?.messages;
  return <section className="profile-panel space-y-5">
    <div className="space-y-3">
      <h3>{t('firebase.browserPush')}</h3>
      <p>{t('firebase.pushDescription')}</p>
      <p role="status" aria-live="polite">{t(`firebase.${browserPush?.busy ? 'working' : status}`)}</p>
      {['calls', 'messages'].map((category) => {
        const enabled = browserPush?.preferences?.[category] === true;
        return <div key={category} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3">
          <div className="min-w-0 flex-1"><strong id={`push-${category}-label`}>{t(`firebase.${category}`)}</strong>
            <p id={`push-${category}-description`} className="text-sm">{t(`firebase.${category}Description`)}</p></div>
          <button type="button" role="switch" aria-checked={enabled} aria-labelledby={`push-${category}-label`} aria-describedby={`push-${category}-description`}
            className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={!browserPush || browserPush.busy || unavailable}
            onClick={() => browserPush.toggleCategory(category)}>{t(enabled ? 'firebase.categoryOn' : 'firebase.categoryOff')}</button>
          <button type="button" className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={!enabled || browserPush?.busy || status !== 'on'} aria-label={t('firebase.testCategory', { category: t(`firebase.${category}`) })}
            onClick={() => browserPush.testNotification(category)}>{t('firebase.test')}</button>
        </div>;
      })}
      {unavailable && hasSavedCategory && <button type="button"
        className="rounded-lg border border-[var(--line)] px-4 py-2 font-semibold disabled:opacity-50"
        disabled={browserPush.busy} onClick={() => { void browserPush.disable().catch(() => {}); }}>{t('firebase.clearAll')}</button>}
      {browserPush?.testSuccess && <p role="status" aria-live="polite">{t('firebase.testAccepted', { category: t(`firebase.${browserPush.testSuccess}`) })}</p>}
      {browserPush?.error && <p role="alert">{t(`firebase.${browserPush.error}`)}</p>}
    </div>
    <div className="space-y-3 border-t border-[var(--line)] pt-5">
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
