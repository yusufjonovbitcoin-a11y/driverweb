import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Clock3,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Route,
  Trash2,
  Truck,
} from 'lucide-react';
import { formatDateTime } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';

function isCompleted(load) {
  return load.databaseStatus
    ? load.databaseStatus === 'completed'
    : load.status === 'COMPLETED';
}

function routeLabel(load) {
  const origin = [load.origin?.city, load.origin?.state].filter(Boolean).join(', ');
  const destination = [load.destination?.city, load.destination?.state].filter(Boolean).join(', ');
  return [origin, destination].filter(Boolean).join(' → ') || '—';
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 min-w-0 break-words text-sm font-bold text-zinc-900 dark:text-zinc-100">{children}</div>
    </div>
  );
}

function Metric({ value, label, tone = 'zinc' }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
    blue: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200',
    zinc: 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-200',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <strong className="block text-xl font-black">{value}</strong>
      <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</span>
    </div>
  );
}

export default function DriverProfilePanel({
  driver,
  loads = [],
  canManage = false,
  deleting = false,
  onBack,
  onEdit,
  onAssignVehicle,
  onAssignLoad,
  onOpenChat,
  onOpenLoad,
  onDelete,
}) {
  const { t } = useTranslation();
  const driverLoads = loads.filter((load) => (
    load.driverId === driver.id || load.targetDriverIds?.includes(driver.id)
  ));
  const activeLoads = driverLoads.filter((load) => !isCompleted(load));
  const completedLoads = driverLoads.length - activeLoads.length;
  const vehicle = driver.vehicle;

  return (
    <section id="company-members-panel" aria-labelledby="driver-profile-title" className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-bold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('header.backToDrivers')}
      </button>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 bg-gradient-to-r from-teal-50 via-white to-emerald-50 p-5 dark:border-zinc-800 dark:from-teal-950/30 dark:via-zinc-900 dark:to-emerald-950/20 lg:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-2xl border border-white/80 bg-white text-lg font-black text-zinc-800 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                {driver.avatar
                  ? <img src={driver.avatar} alt="" className="h-full w-full object-cover" />
                  : <span aria-hidden="true">{driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}</span>}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="driver-profile-title" className="truncate text-2xl font-black text-zinc-950 dark:text-white">{driver.name}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${activeLoads.length ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'}`}>
                    {activeLoads.length ? t('drivers.onLoad') : t('drivers.available')}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-500">{driver.driverNumber || t('common.notProvided')}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onAssignLoad?.(driver)} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2.5 text-xs font-bold text-white transition hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"><Plus className="h-4 w-4" aria-hidden="true" />{t('drivers.assignLoad')}</button>
              <button type="button" onClick={() => onOpenChat?.(driver)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-bold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"><MessageSquare className="h-4 w-4" aria-hidden="true" />{t('drivers.openChat')}</button>
              {canManage && <button type="button" onClick={() => onEdit?.(driver)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-bold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"><Pencil className="h-4 w-4" aria-hidden="true" />{t('common.edit')}</button>}
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:p-6">
          <div className="space-y-5">
            <div>
              <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-zinc-500">{t('drivers.details')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Fact icon={Phone} label={t('common.phone')}>{driver.phone ? <a href={`tel:${driver.phone}`} className="text-teal-700 hover:underline dark:text-teal-300">{driver.phone}</a> : t('common.notProvided')}</Fact>
                <Fact icon={Mail} label={t('common.email')}>{driver.email || t('common.notProvided')}</Fact>
                <Fact icon={MapPin} label={t('drivers.location')}>{driver.currentLocation || t('common.offline')}</Fact>
                <Fact icon={Clock3} label={t('drivers.lastSeen')}>{driver.lastSeenAt ? formatDateTime(driver.lastSeenAt) : t('drivers.neverSeen')}</Fact>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-500"><Truck className="h-4 w-4" aria-hidden="true" />{t('drivers.vehicleDetails')}</h3>
                {canManage && <button type="button" onClick={() => onAssignVehicle?.(driver)} className="text-xs font-bold text-teal-700 hover:underline dark:text-teal-300">{t('fleet.openAssignment')}</button>}
              </div>
              {vehicle ? (
                <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-black text-zinc-900 dark:text-zinc-100">#{vehicle.number}</p><p className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300">{`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()}</p></div>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{t('common.active')}</span>
                  </div>
                  <dl className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 text-xs dark:border-zinc-800 sm:grid-cols-2">
                    <div><dt className="text-zinc-500">{t('fleet.vin')}</dt><dd className="mt-1 break-all font-bold">{vehicle.vin || t('common.notProvided')}</dd></div>
                    <div><dt className="text-zinc-500">{t('fleet.plate')}</dt><dd className="mt-1 font-bold">{[vehicle.plateState, vehicle.plateNumber].filter(Boolean).join(' · ') || t('common.notProvided')}</dd></div>
                    <div><dt className="text-zinc-500">{t('drivers.trailer')}</dt><dd className="mt-1 font-bold">{driver.trailer || t('common.notProvided')}</dd></div>
                  </dl>
                </div>
              ) : (
                <button type="button" onClick={() => canManage && onAssignVehicle?.(driver)} disabled={!canManage} className="w-full rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm font-semibold text-zinc-500 transition enabled:hover:border-teal-500 enabled:hover:text-teal-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-400">{t('fleet.unassigned')}</button>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Metric value={driverLoads.length} label={t('drivers.tripHistory')} />
              <Metric value={activeLoads.length} label={t('drivers.activeTrips')} tone="blue" />
              <Metric value={completedLoads} label={t('loadStatus.completed')} tone="emerald" />
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-500"><Route className="h-4 w-4" aria-hidden="true" />{t('drivers.tripHistory')}</h3>
              <div className="mt-3 space-y-2">
                {driverLoads.length ? driverLoads.slice(0, 5).map((load) => (
                  <button key={load.id} type="button" onClick={() => onOpenLoad?.(load)} className="block w-full rounded-lg border border-zinc-100 p-3 text-left transition hover:border-teal-300 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-zinc-800 dark:hover:border-teal-800 dark:hover:bg-teal-950/20">
                    <span className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-black text-teal-700 dark:text-teal-300">{load.loadNumber}</span><span className="text-[10px] font-bold text-zinc-500">{loadStatusLabel(t, load.status)}</span></span>
                    <span className="mt-1.5 block truncate text-xs font-semibold text-zinc-700 dark:text-zinc-300">{routeLabel(load)}</span>
                  </button>
                )) : <div className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500 dark:bg-zinc-950/40">{t('drivers.noCurrentLoad')}</div>}
              </div>
            </div>
            {canManage && onDelete && (
              <button type="button" onClick={() => onDelete(driver)} disabled={deleting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2.5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('profile.remove')}</button>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
