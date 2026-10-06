import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, X } from 'lucide-react';
import { fetchDriverPaySettings, updateCompanyDriverContact } from '../services/operationsService';
import { parseDriverMileageRate } from '../services/driverPay.js';

export default function DriverContactEditModal({ driver, onClose, onWorkspaceRefresh }) {
  const { t } = useTranslation();
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [payLoaded, setPayLoaded] = useState(false);
  const [fixedPay, setFixedPay] = useState(false);
  const [mileageRate, setMileageRate] = useState('');
  useEffect(() => {
    let disposed = false;
    fetchDriverPaySettings(driver.id).then(rate => {
      if (disposed) return;
      setFixedPay(rate != null);
      setMileageRate(rate == null ? '' : String(rate));
      setPayLoaded(true);
    }).catch(() => { if (!disposed) setError(t('driverPay.loadError')); });
    return () => { disposed = true; };
  }, [driver.id, t]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const save = async (event) => {
    event.preventDefault();
    if (saving || !payLoaded || name.trim().length < 2) return;
    const rate = fixedPay ? parseDriverMileageRate(mileageRate) : null;
    if (fixedPay && rate == null) { setError(t('driverPay.invalidRate')); return; }
    setSaving(true);
    setError('');
    try {
      await updateCompanyDriverContact(driver.id, { name, phone, ratePerMile: rate });
      await onWorkspaceRefresh?.();
      onClose();
    } catch {
      setError(t('drivers.contactSaveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="driver-contact-title" className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
          <div>
            <h2 id="driver-contact-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{t('profile.editDriver')}</h2>
            <p className="mt-1 text-xs text-zinc-500">{driver.driverNumber || driver.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t('common.close')} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="space-y-4 p-5">
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300">{t('profile.fullName')}
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
          </label>
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300">{t('common.phone')}
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
          </label>
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60">
            <span className="font-semibold">{t('common.email')}:</span> {driver.email || t('common.notProvided')}
            <p className="mt-1">{t('profile.driverSystemFieldsHint')}</p>
          </div>
          <fieldset disabled={!payLoaded || saving} className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <legend className="px-1 text-sm font-semibold">{t('driverPay.title')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fixedPay} onChange={event => setFixedPay(event.target.checked)} />
              {t('driverPay.enabled')}
            </label>
            {fixedPay && <label className="block text-xs font-semibold">{t('driverPay.rate')}
              <input type="number" inputMode="decimal" min="0.0001" max="100" step="0.0001" required value={mileageRate}
                onChange={event => setMileageRate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </label>}
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t('driverPay.hint')}</p>
          </fieldset>
          {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">{t('common.cancel')}</button>
            <button type="submit" disabled={saving || !payLoaded || name.trim().length < 2} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{t('common.save')}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
