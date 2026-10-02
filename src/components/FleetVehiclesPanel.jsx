import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceQuery } from '../hooks/WorkspaceCache';
import {
  CheckCircle2,
  LoaderCircle,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Truck,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  createFleetVehicle,
  decodeVehicleVin,
  fetchFleetVehicles,
  updateFleetVehicle,
} from '../services/operationsService';
import {
  emptyVehicleForm,
  FUEL_TYPES,
  US_STATES,
  validateVehicleForm,
  vehicleToForm,
} from '../services/fleetVehicleModel';
import { isCompleteVin, normalizeVin } from '../services/nhtsaVin';

const inputClass = 'mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm font-semibold text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

export default function FleetVehiclesPanel({ canManage, onWorkspaceRefresh }) {
  const { t } = useTranslation();
  const { data: vehicles = [], isLoading: loading, error: loadError, mutate: refresh } = useWorkspaceQuery('fleet-vehicles', fetchFleetVehicles);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [form, setForm] = useState(emptyVehicleForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [vinStatus, setVinStatus] = useState('idle');
  const [vinRetryKey, setVinRetryKey] = useState(0);
  const manuallyEditedFields = useRef(new Set());

  useEffect(() => {
    if (!formOpen || editingVehicle || !isCompleteVin(form.vin)) return undefined;
    const vin = form.vin;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setVinStatus('loading');
      try {
        const decoded = await decodeVehicleVin(vin, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!decoded) {
          setVinStatus('notFound');
          return;
        }
        setForm((current) => {
          if (current.vin !== vin) return current;
          const next = { ...current };
          for (const field of ['make', 'model', 'modelYear', 'fuelType']) {
            if (decoded[field] && !manuallyEditedFields.current.has(field)) {
              next[field] = decoded[field];
            }
          }
          return next;
        });
        setVinStatus('found');
      } catch {
        if (!controller.signal.aborted) setVinStatus('error');
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.vin, formOpen, editingVehicle, vinRetryKey]);

  const filteredVehicles = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return vehicles;
    return vehicles.filter((vehicle) => [
      vehicle.vehicleNumber,
      vehicle.vin,
      vehicle.make,
      vehicle.model,
      vehicle.plateNumber,
      vehicle.driverName,
    ].some((field) => field?.toLowerCase().includes(value)));
  }, [query, vehicles]);

  const openForm = (vehicle = null) => {
    manuallyEditedFields.current.clear();
    setVinStatus('idle');
    setFormOpen(true);
    setEditingVehicle(vehicle);
    setForm(vehicleToForm(vehicle));
    setFormErrors({});
    setError('');
  };

  const closeForm = () => {
    manuallyEditedFields.current.clear();
    setVinStatus('idle');
    setFormOpen(false);
    setEditingVehicle(null);
    setForm(emptyVehicleForm());
    setFormErrors({});
  };

  const retryVin = () => {
    setVinStatus('idle');
    setVinRetryKey((current) => current + 1);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const validation = validateVehicleForm(form);
    setFormErrors(validation.errors);
    if (!validation.valid) return;

    setSaving(true);
    setError('');
    try {
      if (editingVehicle) {
        await updateFleetVehicle(editingVehicle.id, validation.value, editingVehicle.status);
      } else {
        await createFleetVehicle(validation.value);
      }
      await refresh();
      await onWorkspaceRefresh?.();
      setSaved(t(editingVehicle ? 'fleet.updated' : 'fleet.created'));
      window.setTimeout(() => setSaved(''), 3500);
      setFormOpen(false);
      setEditingVehicle(null);
      setForm(emptyVehicleForm());
      setFormErrors({});
    } catch (cause) {
      setError(cause?.message || t('fleet.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field, value) => {
    if (field === 'vin') {
      setVinStatus('idle');
      setForm((current) => ({
        ...current,
        vin: value,
        make: manuallyEditedFields.current.has('make') ? current.make : '',
        model: manuallyEditedFields.current.has('model') ? current.model : '',
        modelYear: manuallyEditedFields.current.has('modelYear')
          ? current.modelYear
          : String(new Date().getFullYear()),
        fuelType: manuallyEditedFields.current.has('fuelType') ? current.fuelType : 'diesel',
      }));
    } else {
      if (['make', 'model', 'modelYear', 'fuelType'].includes(field)) {
        manuallyEditedFields.current.add(field);
      }
      setForm((current) => ({ ...current, [field]: value }));
    }
    setFormErrors((current) => ({ ...current, [field]: undefined, plate: undefined }));
  };

  const editing = editingVehicle !== null;
  const year = new Date().getFullYear();
  const years = Array.from({ length: year - 1977 }, (_, index) => year + 2 - index);

  return (
    <div id="company-members-panel" role="region" aria-label={t('fleet.title')} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-lg font-black text-zinc-900 dark:text-zinc-100">{t('fleet.title')}</h4>
          <p className="mt-0.5 text-sm text-zinc-500">{t('fleet.description')}</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => openForm()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white">
            <Plus className="h-4 w-4" />{t('fleet.addVehicle')}
          </button>
        )}
      </div>

      {saved && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{saved}</div>}
      {(error || loadError) && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error || loadError?.message || t('fleet.loadError')}</div>}

      <label className="relative block max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('fleet.search')} className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-teal-500 dark:border-zinc-800 dark:bg-zinc-900" />
      </label>

      {loading ? (
        <div className="grid min-h-48 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : filteredVehicles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <Truck className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 font-bold">{t('fleet.empty')}</p>
          <p className="mt-1 text-sm text-zinc-500">{t('fleet.emptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full min-w-[880px] text-left text-sm">
            <caption className="sr-only">{t('fleet.title')}</caption>
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50">
              <tr>
                <th scope="col" className="px-4 py-3">{t('fleet.vehicleNumber')}</th>
                <th scope="col" className="px-4 py-3">{t('fleet.vin')}</th>
                <th scope="col" className="px-4 py-3">{t('fleet.plate')}</th>
                <th scope="col" className="px-4 py-3">{t('fleet.fuelType')}</th>
                <th scope="col" className="px-4 py-3">{t('fleet.assignedDriver')}</th>
                <th scope="col" className="px-4 py-3">{t('common.status')}</th>
                {canManage && <th scope="col" className="px-4 py-3 text-right">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredVehicles.map((vehicle) => (
                <tr key={vehicle.id} className="transition-colors hover:bg-teal-50/40 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"><Truck className="h-5 w-5" /></span>
                      <div className="min-w-0"><div className="font-black text-zinc-900 dark:text-zinc-100">#{vehicle.vehicleNumber}</div><div className="max-w-44 truncate text-xs font-medium text-zinc-500" title={`${vehicle.modelYear} ${vehicle.make} ${vehicle.model}`}>{vehicle.modelYear} {vehicle.make} {vehicle.model}</div></div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">{vehicle.vin}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-700 dark:text-zinc-300">{[vehicle.plateIssuedState, vehicle.plateNumber].filter(Boolean).join(' · ') || t('common.notProvided')}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{t(`fleet.fuels.${vehicle.fuelType}`)}</td>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">{vehicle.driverName || <span className="text-zinc-400">{t('fleet.unassigned')}</span>}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${vehicle.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{t(`fleet.statuses.${vehicle.status}`, { defaultValue: vehicle.status })}</span></td>
                  {canManage && <td className="px-4 py-3 text-right"><button type="button" onClick={() => openForm(vehicle)} aria-label={`${t('common.edit')}: #${vehicle.vehicleNumber}`} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold transition hover:border-teal-300 hover:bg-teal-50 dark:border-zinc-700 dark:hover:bg-zinc-800"><Pencil className="h-3.5 w-3.5" />{t('common.edit')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && canManage && (
        <VehicleFormModal
          t={t}
          editing={editing}
          form={form}
          errors={formErrors}
          years={years}
          saving={saving}
          error={error}
          vinStatus={vinStatus}
          onVinRetry={retryVin}
          onField={updateField}
          onClose={() => { if (!saving) closeForm(); }}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function VehicleFormModal({ t, editing, form, errors, years, saving, error, vinStatus, onVinRetry, onField, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-[160] grid place-items-center bg-zinc-950/60 p-3 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="vehicle-form-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div><h3 id="vehicle-form-title" className="text-lg font-black">{t(editing ? 'fleet.editVehicle' : 'fleet.addVehicle')}</h3><p className="mt-0.5 text-xs text-zinc-500">{t('fleet.formHint')}</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t('common.close')} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </header>
        <form onSubmit={onSubmit} className="space-y-5 p-5">
          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fleet.vehicleNumber')} errorText={errors.vehicleNumber ? t('fleet.invalidField') : ''}><input autoFocus required maxLength={30} value={form.vehicleNumber} onChange={(event) => onField('vehicleNumber', event.target.value)} className={inputClass} placeholder="007" /></Field>
            <div>
              <Field label={t('fleet.vin')} errorText={errors.vin ? t('fleet.invalidVin') : ''} hint={editing ? t('fleet.vinImmutable') : ''}>
                <span className="relative block">
                  <span className={`absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg transition-colors ${vinStatus === 'found' ? 'vin-verified-icon bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'}`} aria-hidden="true">{vinStatus === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : vinStatus === 'found' ? <CheckCircle2 className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}</span>
                  <input required minLength={17} maxLength={17} disabled={editing} value={form.vin} onChange={(event) => onField('vin', normalizeVin(event.target.value))} className={`${inputClass} pl-12 font-mono uppercase ${vinStatus === 'found' ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/15 dark:border-emerald-700' : ''}`} placeholder="4V4BC9EH7TN704159" />
                </span>
              </Field>
              {!editing && vinStatus !== 'idle' && <p role="status" className={`mt-1.5 flex items-center gap-1.5 text-xs font-semibold ${vinStatus === 'found' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>{t(`fleet.vinLookup.${vinStatus}`)}{vinStatus === 'error' && <button type="button" onClick={onVinRetry} className="font-bold text-teal-700 underline underline-offset-2 dark:text-teal-300">{t('common.retry')}</button>}</p>}
            </div>
            <Field label={t('fleet.make')} errorText={errors.make ? t('fleet.invalidField') : ''}><input required maxLength={80} value={form.make} onChange={(event) => onField('make', event.target.value)} className={inputClass} placeholder="VOLVO TRUCK" /></Field>
            <Field label={t('fleet.model')} errorText={errors.model ? t('fleet.invalidField') : ''}><input required maxLength={80} value={form.model} onChange={(event) => onField('model', event.target.value)} className={inputClass} placeholder="VNL (4)" /></Field>
            <Field label={t('fleet.year')} errorText={errors.modelYear ? t('fleet.invalidField') : ''}><select value={form.modelYear} onChange={(event) => onField('modelYear', event.target.value)} className={inputClass}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label={t('fleet.fuelType')} errorText={errors.fuelType ? t('fleet.invalidField') : ''}><select value={form.fuelType} onChange={(event) => onField('fuelType', event.target.value)} className={inputClass}>{FUEL_TYPES.map((item) => <option key={item} value={item}>{t(`fleet.fuels.${item}`)}</option>)}</select></Field>
            <Field label={t('fleet.plateState')} errorText={errors.plate ? t('fleet.platePairRequired') : ''}><select value={form.plateIssuedState} onChange={(event) => onField('plateIssuedState', event.target.value)} className={inputClass}><option value="">{t('common.notProvided')}</option>{US_STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}</select></Field>
            <Field label={t('fleet.plateNumber')} errorText={errors.plate ? t('fleet.platePairRequired') : ''}><input maxLength={20} value={form.plateNumber} onChange={(event) => onField('plateNumber', event.target.value.toUpperCase())} className={`${inputClass} uppercase`} placeholder="APPLIED" /></Field>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-700">
            <input type="checkbox" checked={!form.sleeperBerthEnabled} onChange={(event) => onField('sleeperBerthEnabled', !event.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-600" />
            <span><span className="block text-sm font-bold">{t('fleet.disableSleeper')}</span><span className="mt-1 block text-xs leading-5 text-zinc-500">{t('fleet.disableSleeperHint')}</span></span>
          </label>

          <Field label={t('fleet.notes')} errorText={errors.notes ? t('fleet.notesTooLong') : ''}><textarea rows={4} maxLength={4000} value={form.notes} onChange={(event) => onField('notes', event.target.value)} className={inputClass} placeholder={t('fleet.notesPlaceholder')} /></Field>

          <footer className="flex justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-bold dark:border-zinc-700">{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-600 disabled:opacity-60">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{t(editing ? 'fleet.updateVehicle' : 'fleet.createVehicle')}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Field({ label, errorText, hint, children }) {
  return <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300"><span>{label}</span>{children}{hint && <span className="mt-1.5 block font-normal leading-4 text-zinc-500">{hint}</span>}{errorText && <span className="mt-1.5 block text-red-600">{errorText}</span>}</label>;
}
