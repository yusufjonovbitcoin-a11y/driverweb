import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, Truck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  assignFleetVehicleDriver,
  fetchFleetVehicles,
  unassignFleetVehicleDriver,
} from '../services/operationsService';

export default function DriverVehicleAssignmentModal({ driver, onClose, onWorkspaceRefresh }) {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchFleetVehicles().then((rows) => {
      if (!active) return;
      setVehicles(rows);
      setSelectedVehicleId(rows.find((vehicle) => vehicle.driverId === driver.id)?.id || '');
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      setError(cause?.message || t('fleet.loadError'));
      setLoading(false);
    });
    return () => { active = false; };
  }, [driver.id, t]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const currentVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.driverId === driver.id),
    [vehicles, driver.id],
  );
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const changed = (currentVehicle?.id || '') !== selectedVehicleId;

  const submit = async (event) => {
    event.preventDefault();
    if (loading || saving || !changed) return;
    setSaving(true);
    setError('');
    try {
      if (selectedVehicleId) {
        await assignFleetVehicleDriver(selectedVehicleId, driver.id);
      } else if (currentVehicle) {
        await unassignFleetVehicleDriver(currentVehicle.id);
      }
      await onWorkspaceRefresh?.();
      onClose();
    } catch (cause) {
      setError(cause?.message || t('fleet.assignmentError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] grid place-items-center bg-zinc-950/60 p-3 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="driver-vehicle-title" className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h3 id="driver-vehicle-title" className="text-lg font-black text-zinc-900 dark:text-zinc-100">{t('fleet.assignToDriver', { name: driver.name })}</h3>
            <p className="mt-1 text-xs text-zinc-500">{t('fleet.assignmentHint')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t('common.close')} className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </header>

        <form onSubmit={submit} className="p-5">
          {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          {loading ? (
            <div className="grid min-h-40 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-teal-600" /></div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">{t('fleet.selectVehicle')}</legend>
              <div className="max-h-[min(48vh,360px)] space-y-2 overflow-y-auto pr-1">
                <VehicleOption
                  value=""
                  selected={selectedVehicleId === ''}
                  onSelect={setSelectedVehicleId}
                  label={t('fleet.unassigned')}
                  detail={t('fleet.unassignHint')}
                />
                {vehicles.filter((vehicle) => vehicle.status === 'active' || vehicle.id === currentVehicle?.id).map((vehicle) => (
                  <VehicleOption
                    key={vehicle.id}
                    value={vehicle.id}
                    selected={selectedVehicleId === vehicle.id}
                    onSelect={setSelectedVehicleId}
                    label={`#${vehicle.vehicleNumber} · ${vehicle.make} ${vehicle.model}`}
                    detail={`${vehicle.modelYear} · ${vehicle.vin}`}
                    occupied={vehicle.driverId && vehicle.driverId !== driver.id ? vehicle.driverName : ''}
                    disabled={vehicle.status !== 'active'}
                  />
                ))}
              </div>
            </fieldset>
          )}
          {selectedVehicle?.driverId && selectedVehicle.driverId !== driver.id && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{t('fleet.reassignWarning', { name: selectedVehicle.driverName })}</p>
          )}
          <footer className="mt-5 flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-bold dark:border-zinc-700">{t('common.cancel')}</button>
            <button type="submit" disabled={loading || saving || !changed} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{t('fleet.saveAssignment')}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function VehicleOption({ value, selected, onSelect, label, detail, occupied, disabled = false }) {
  return (
    <label className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ${selected ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-zinc-200 hover:border-teal-300 dark:border-zinc-700'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input type="radio" name="assigned-vehicle" value={value} checked={selected} disabled={disabled} onChange={() => onSelect(value)} className="h-4 w-4 accent-teal-700" />
      <Truck className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{label}</span><span className="block truncate text-xs text-zinc-500">{detail}</span>{occupied && <span className="block text-xs font-semibold text-amber-700 dark:text-amber-300">{occupied}</span>}</span>
      {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" aria-hidden="true" />}
    </label>
  );
}
