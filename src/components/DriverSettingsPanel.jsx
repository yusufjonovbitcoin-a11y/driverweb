import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, LoaderCircle, ShieldCheck, Truck } from 'lucide-react';
import { fetchDriverPaySettings, updateCompanyDriverContact } from '../services/operationsService';
import { fetchDriverAccountStatus, fetchDriverSettingsHistory, setDriverAccountStatus } from '../services/driverSettingsService';
import { parseDriverMileageRate } from '../services/driverPay';
import { formatDate } from '../i18n/format';
import DriverVehicleAssignmentModal from './DriverVehicleAssignmentModal';
import './driverSettings.css';

export default function DriverSettingsPanel({ driver, onWorkspaceRefresh, canManageDriver }) {
  const { t } = useTranslation();
  const id = useId();
  const [form, setForm] = useState({ name: driver.name || '', phone: driver.phone || '', fixedPay: false, rate: '', hideRateCon: false });
  const [baseline, setBaseline] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [accountError, setAccountError] = useState(false);
  const [accountAttempt, setAccountAttempt] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [history, setHistory] = useState(null);
  const [expandedHistory, setExpandedHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetchDriverAccountStatus(driver.id).then((value) => { if (active) { setAccount(value); setAccountError(false); } }).catch(() => { if (active) setAccountError(true); });
    return () => { active = false; };
  }, [driver.id, accountAttempt]);
  useEffect(() => {
    let active = true;
    fetchDriverSettingsHistory(driver.id).then((rows) => { if (active) { setHistory(rows); setHistoryError(false); } }).catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [driver.id, historyAttempt]);
  const changeStatus = async () => {
    if (!canManageDriver || statusBusy || !['active', 'suspended'].includes(account)) return;
    setStatusBusy(true); setAccountError(false);
    try {
      setAccount(await setDriverAccountStatus(driver.id, account === 'active' ? 'suspended' : 'active'));
      setConfirmStatus(false); setHistoryAttempt((value) => value + 1);
      try { await onWorkspaceRefresh?.(); }
      catch { setError('driverSettings.refreshError'); }
    } catch { setAccountError(true); }
    finally { setStatusBusy(false); }
  };
  useEffect(() => {
    let active = true;
    fetchDriverPaySettings(driver.id).then((settings) => {
      if (!active) return;
      const initial = { name: driver.name || '', phone: driver.phone || '', fixedPay: settings.ratePerMile != null, rate: settings.ratePerMile == null ? '' : String(settings.ratePerMile), hideRateCon: settings.hideRateCon };
      setForm(initial); setBaseline(initial); setLoading(false); setError('');
    }).catch(() => { if (active) { setLoading(false); setError('driverPay.loadError'); } });
    return () => { active = false; };
    // Contact refreshes must not discard an unsaved form; remount when switching drivers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, attempt]);
  const update = (key, value) => { setForm((previous) => ({ ...previous, [key]: value })); setSaved(false); };
  const dirty = baseline && JSON.stringify(form) !== JSON.stringify(baseline);
  const save = async (event) => {
    event.preventDefault();
    if (!canManageDriver || saving || !baseline || !dirty) return;
    const rate = form.fixedPay ? parseDriverMileageRate(form.rate) : null;
    if (form.fixedPay && rate == null) { setError('driverPay.invalidRate'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await updateCompanyDriverContact(driver.id, { name: form.name, phone: form.phone, ratePerMile: rate, hideRateCon: form.hideRateCon });
      setBaseline(form); setSaved(true); setHistoryAttempt((value) => value + 1);
      try { await onWorkspaceRefresh?.(); }
      catch { setError('driverSettings.refreshError'); }
    } catch { setError('drivers.contactSaveError'); }
    finally { setSaving(false); }
  };
  const sectionTitle = (number, key) => <div className="driver-settings-section-heading"><span>{number}</span><h3>{t(`driverSettings.${key}`)}</h3></div>;
  const lastSeen = driver.lastSeenAt && Number.isFinite(Date.parse(driver.lastSeenAt)) ? formatDate(driver.lastSeenAt, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return <div className="driver-settings-layout">
    <form className="driver-settings-form" onSubmit={save}>
      <header><h2>{t('driverSettings.title')}</h2><p>{t('driverSettings.subtitle')}</p></header>
      <fieldset disabled={saving || loading || !baseline || !canManageDriver}>
        <section>{sectionTitle('01', 'contacts')}<div className="driver-settings-fields">
          <label>{t('profile.fullName')}<input value={form.name} onChange={(e) => update('name', e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>
          <label>{t('common.phone')}<input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} maxLength={40} autoComplete="tel" /></label>
          <label>{t('common.email')}<input value={driver.email || '—'} readOnly /></label>
          <label>{t('driverDetailTabs.driverNumber')}<input value={driver.driverNumber || '—'} readOnly /></label>
        </div><p className="driver-settings-hint">{t('profile.driverSystemFieldsHint')}</p></section>
        <section>{sectionTitle('02', 'equipment')}<div className="driver-settings-vehicle"><Truck size={22} /><div><strong>{driver.truck || t('common.notProvided')}</strong><p>{[driver.vehicle?.make, driver.vehicle?.model, driver.vehicle?.year].filter(Boolean).join(' · ') || t('driverSettings.vehicleHint')}</p></div><button type="button" onClick={() => setVehicleOpen(true)} disabled={loading || saving}>{t('driverSettings.manageVehicle')}</button></div><p className="driver-settings-hint">{t('driverDetailTabs.trailer')}: {driver.trailer || '—'}</p></section>
        <section>{sectionTitle('03', 'pay')}<label className="driver-settings-toggle"><span><strong>{t('driverPay.enabled')}</strong><small>{t('driverPay.hint')}</small></span><input type="checkbox" checked={form.fixedPay} disabled={loading || !baseline} onChange={(e) => update('fixedPay', e.target.checked)} /></label>
          {form.fixedPay && <label className="driver-settings-rate">{t('driverPay.rate')}<input type="number" inputMode="decimal" min="0.0001" max="100" step="0.0001" required value={form.rate} disabled={loading || !baseline} onChange={(e) => update('rate', e.target.value)} /></label>}
        </section>
        <section>{sectionTitle('04', 'documents')}<label className="driver-settings-toggle"><span><strong>{t('driverSettings.showRateCon')}</strong><small id={`${id}-privacy`}>{t('driverSettings.documentHint')}</small></span><input type="checkbox" role="switch" aria-describedby={`${id}-privacy`} checked={!form.hideRateCon} disabled={loading || !baseline} onChange={(e) => update('hideRateCon', !e.target.checked)} /></label></section>
      </fieldset>
      <footer>
        <div aria-live="polite">{loading ? <span>{t('driverSettings.loading')}</span> : saved ? <span className="driver-settings-success"><Check size={15} />{t('driverSettings.saved')}</span> : <span>{t(canManageDriver ? 'driverSettings.saveHint' : 'driverSettings.readOnly')}</span>}</div>
        <button type="button" disabled={!dirty || saving} onClick={() => { setForm(baseline); setError(''); setSaved(false); }}>{t('common.cancel')}</button>
        <button type="submit" className="driver-settings-save" disabled={!canManageDriver || !dirty || saving || loading || form.name.trim().length < 2}>{saving && <LoaderCircle size={16} className="animate-spin" />}{t('common.save')}</button>
      </footer>
      {error && <div className="driver-settings-error" role="alert">{t(error)}{!baseline && <button type="button" onClick={() => { setLoading(true); setAttempt((value) => value + 1); }}>{t('driverSettings.retry')}</button>}</div>}
    </form>
    <aside className="driver-settings-aside">
      <section><ShieldCheck size={22} /><h3>{t('driverSettings.account')}</h3>
        {account && <span className={`driver-settings-status ${account === 'active' ? 'is-active' : ''}`}>{['active', 'suspended'].includes(account) ? t(`driverSettings.${account}`) : account}</span>}
        <dl><div><dt>{t('driverDetailTabs.driverNumber')}</dt><dd>{driver.driverNumber || '—'}</dd></div><div><dt>{t('common.email')}</dt><dd>{driver.email || '—'}</dd></div><div><dt>{t('driverDetailTabs.connection')}</dt><dd>{t(driver.isOnline ? 'driverDetailTabs.online' : 'driverDetailTabs.offline')}</dd></div></dl>
        {accountError && <p role="alert">{t('driverSettings.accountError')} <button type="button" disabled={statusBusy} onClick={() => setAccountAttempt((value) => value + 1)}>{t('driverSettings.retry')}</button></p>}
        {canManageDriver && ['active', 'suspended'].includes(account) && <div className="driver-settings-account-action">{confirmStatus ? <><p>{t('driverSettings.confirmStatus')}</p><button type="button" disabled={statusBusy} onClick={changeStatus}>{t(account === 'active' ? 'driverSettings.suspend' : 'driverSettings.activate')}</button><button type="button" disabled={statusBusy} onClick={() => setConfirmStatus(false)}>{t('common.cancel')}</button></> : <button type="button" disabled={saving || statusBusy} onClick={() => setConfirmStatus(true)}>{t(account === 'active' ? 'driverSettings.suspend' : 'driverSettings.activate')}</button>}</div>}
      </section>
      <section><h3>{t('driverSettings.history')}</h3>{lastSeen && <p><strong>{t('driverDetailTabs.lastSeen')}</strong><br />{lastSeen}</p>}
        {historyError ? <p role="alert">{t('driverSettings.historyError')} <button type="button" onClick={() => setHistoryAttempt((value) => value + 1)}>{t('driverSettings.retry')}</button></p> : history === null ? <p>{t('driverSettings.loading')}</p> : history.length ? <><ol id={`${id}-history`} className="driver-settings-history">{(expandedHistory ? history : history.slice(0, 3)).map((event) => <li key={event.id}><strong>{t(event.action === 'member.status_changed' ? 'driverSettings.statusChanged' : ['driver.contact_updated', 'driver.pay_settings_updated', 'driver.rate_con_privacy_updated'].includes(event.action) ? 'driverSettings.contactChanged' : 'driverSettings.otherChange')}</strong><time dateTime={event.occurred_at}>{formatDate(event.occurred_at, { dateStyle: 'medium', timeStyle: 'short' })}</time>{event.actor_id && <small>{t('driverSettings.actor')} · {event.actor_id.slice(0, 8)}</small>}</li>)}</ol>{history.length > 3 && <button type="button" aria-expanded={expandedHistory} aria-controls={`${id}-history`} onClick={() => setExpandedHistory((value) => !value)}>{t(expandedHistory ? 'driverSettings.lessHistory' : 'driverSettings.allHistory')}</button>}</> : <p className="driver-settings-hint">{t('driverSettings.noHistory')}</p>}
      </section>
    </aside>
    {vehicleOpen && <DriverVehicleAssignmentModal driver={driver} onClose={() => setVehicleOpen(false)} onWorkspaceRefresh={onWorkspaceRefresh} />}
  </div>;
}
