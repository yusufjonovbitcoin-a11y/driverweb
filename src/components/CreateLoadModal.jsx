import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Paperclip, Search, Send, X } from 'lucide-react';
import { normalizeManualLoad } from '../services/manualLoad';
import { localizedError } from '../i18n/errors';

const inputClass = 'mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';

export default function CreateLoadModal({ isOpen, onClose, drivers = [], onCreateLoad, onDocument, initialDriverId = null }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => ({
    loadNumber: `MANUAL-${crypto.randomUUID()}`,
    broker: '', equipment: '', commodity: '', rate: '', distanceMiles: '', weightLbs: '',
    originCity: '', originState: '', originAddress: '', originFacility: '',
    destinationCity: '', destinationState: '', destinationAddress: '', destinationFacility: '',
  }));
  const [selectedDriverIds, setSelectedDriverIds] = useState(() => initialDriverId ? [initialDriverId] : []);
  const [driverSearch, setDriverSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const availableIds = drivers.map((driver) => driver.id);
  const selectedIds = selectedDriverIds.filter((id) => availableIds.includes(id));
  const filteredDrivers = drivers.filter((driver) => [driver.name, driver.driverNumber, driver.truck].some((value) => value?.toLowerCase().includes(driverSearch.trim().toLowerCase())));

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) onClose();
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')].filter((item) => item.getClientRects().length);
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => { dialog.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, [isOpen, onClose]);

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const field = (name, label, { required = false, type = 'text' } = {}) => (
    <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
      {label}{required && ' *'}
      <input name={name} value={form[name]} onChange={update} type={type} required={required} min={name === 'weightLbs' ? '1' : type === 'number' ? '0' : undefined} step={name === 'weightLbs' ? '1' : type === 'number' ? 'any' : undefined} className={inputClass} />
    </label>
  );

  const submit = async (event) => {
    event.preventDefault();
    if (busyRef.current) return;
    setError('');
    let load;
    try { load = normalizeManualLoad(form, selectedDriverIds, availableIds); }
    catch (cause) { setError(localizedError(t, cause)); return; }
    busyRef.current = true;
    setSubmitting(true);
    try { await onCreateLoad(load); }
    catch (cause) { setError(localizedError(t, cause, 'errors.createLoad')); }
    finally { busyRef.current = false; setSubmitting(false); }
  };

  const attachDocument = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busyRef.current || !onDocument) return;
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/') && !/\.pdf$/i.test(file.name)) {
      setError(t('errors.fileRequired')); return;
    }
    busyRef.current = true;
    setSubmitting(true);
    setError('');
    try { await onDocument(file, selectedIds[0] || null); }
    catch (cause) { setError(localizedError(t, cause, 'errors.documentAnalysis')); }
    finally { busyRef.current = false; setSubmitting(false); }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs sm:p-6">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-load-title" className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div><h2 id="create-load-title" className="font-bold text-zinc-900 dark:text-white">{t('loads.new')}</h2><p className="mt-1 text-xs text-zinc-500">{t('loads.newHint')}</p></div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label={t('common.close')} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </header>
        <form onSubmit={submit} className="overflow-y-auto p-5">
          <fieldset disabled={submitting} className="space-y-4 disabled:opacity-60">
            {onDocument && <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50 px-4 py-4 text-sm font-semibold text-blue-700 focus-within:ring-2 focus-within:ring-blue-500 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
              <Paperclip className="h-5 w-5" /> {t('loads.createFromDocument')}
              <input type="file" aria-label={t('errors.fileRequired')} accept=".pdf,image/*" onChange={attachDocument} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field('loadNumber', t('loads.loadNumber'), { required: true })}
              {field('broker', t('loads.broker'), { required: true })}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><h3 className="text-sm font-bold text-blue-700 dark:text-blue-300">A · {t('inbox.pickup')}</h3>{field('originCity', t('loads.city'), { required: true })}{field('originState', t('loads.region'), { required: true })}{field('originAddress', t('loads.address'))}</div>
              <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><h3 className="text-sm font-bold text-red-600 dark:text-red-400">B · {t('inbox.delivery')}</h3>{field('destinationCity', t('loads.city'), { required: true })}{field('destinationState', t('loads.region'), { required: true })}{field('destinationAddress', t('loads.address'))}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">{field('equipment', t('loads.equipment'), { required: true })}{field('rate', t('loads.rate'), { required: true, type: 'number' })}{field('distanceMiles', t('loads.distance'), { required: true, type: 'number' })}</div>
          <details className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><summary className="cursor-pointer text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('loads.additionalDetails')}</summary><div className="mt-3 grid grid-cols-2 gap-3">{field('weightLbs', t('loads.weightLbs'), { type: 'number' })}{field('commodity', t('loads.commodity'))}{field('originFacility', t('loads.originFacility'))}{field('destinationFacility', t('loads.destinationFacility'))}</div></details>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-zinc-900 dark:text-white">{t('loads.selectDriver')}</h3>{selectedIds.length > 0 && <button type="button" onClick={() => setSelectedDriverIds([])} className="text-xs font-semibold text-blue-600">{t('loads.clearSelection')}</button>}</div>
          <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" /><input aria-label={t('drivers.search')} value={driverSearch} onChange={(event) => setDriverSearch(event.target.value)} placeholder={t('drivers.searchPlaceholder')} className={`${inputClass} mt-0 pl-9`} /></label>
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {filteredDrivers.map((driver) => <label key={driver.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"><input type="radio" name="assigned-driver" checked={selectedIds.includes(driver.id)} onChange={() => setSelectedDriverIds([driver.id])} className="h-4 w-4 accent-blue-600" /><span className="font-semibold">{driver.name}</span><span className="text-xs text-zinc-500">{driver.driverNumber}</span></label>)}
                {!filteredDrivers.length && <p className="py-3 text-center text-sm text-zinc-500">{t('drivers.noDrivers')}</p>}
              </div>
            </div>
          </fieldset>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          <footer className="mt-4 flex justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"><button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-3 py-2 text-sm text-zinc-500 disabled:opacity-50">{t('common.cancel')}</button><button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{submitting ? t('loads.preparing') : selectedIds.length ? t('loads.createAndAssign') : t('loads.createOnly')}</button></footer>
        </form>
      </section>
    </div>
  );
}
