import React, { useEffect, useMemo, useRef } from 'react';
import { unstable_serialize, useSWRConfig } from 'swr';
import { useWorkspaceQuery, useWorkspaceView } from '../hooks/WorkspaceCache';
import { useTranslation } from 'react-i18next';
import { CircleDollarSign, Clock3, Gauge, Hash, LocateFixed, MapPin, PackageOpen, Phone, Route, Scale, Truck } from 'lucide-react';
import { fetchDriverTrack, fetchDriverTrackingSessions } from '../services/trackingService';
import { formatCurrency, formatDateTime, formatNumber } from '../i18n/format';
import { currentDriverLoad, knownLoadStatistics, loadStageIndex } from './mapLoadStatsModel';

const TrackingMap = React.lazy(() => import('./TrackingMap'));
const EMPTY_POINTS = [];

function hasCoordinates(driver) {
  return Number.isFinite(driver?.lat) && Number.isFinite(driver?.lng);
}

function stopAddress(stop) {
  return [stop?.address, stop?.city, stop?.state, stop?.postalCode].filter(Boolean).join(', ');
}

export default function FleetMap({ drivers, loads, isVisible = true }) {
  const { t } = useTranslation();
  const [selectedTruckId, setSelectedTruckId] = useWorkspaceView('map.driver', drivers[0]?.id || null);
  const [selectedLoadId, setSelectedLoadId] = useWorkspaceView('map.load', null);
  const { cache } = useSWRConfig();
  const selectedDriver = drivers.find((driver) => driver.id === selectedTruckId) || drivers[0];
  const hiddenAtRef = useRef(null);
  const { data: sessions, mutate: refreshSessions } = useWorkspaceQuery(
    selectedDriver?.id ? ['driver-sessions', selectedDriver.id] : null,
    ([, driverId]) => fetchDriverTrackingSessions(driverId),
    { staleTime: 60_000, refreshInterval: isVisible ? 120_000 : 0,
      revalidateOnFocus: isVisible, isPaused: () => !isVisible },
  );
  const driverLoads = useMemo(() => {
    const historicIds = new Set((sessions || []).map(session => session.load_id));
    return loads.filter((load) => load.driverId === selectedDriver?.id || historicIds.has(load.id));
  }, [loads, selectedDriver?.id, sessions]);
  const currentLoad = currentDriverLoad(driverLoads, selectedDriver?.id);
  const driverLoad = driverLoads.find((load) => load.id === selectedLoadId)
    || currentLoad
    || driverLoads[0];
  const statisticsLoad = currentLoad || driverLoad;
  const routeKey = `${selectedDriver?.id || ''}:${driverLoad?.id || ''}`;
  const isActiveLoad = Boolean(
    driverLoad
      && selectedDriver
      && driverLoad.driverId === selectedDriver.id
      && ['ASSIGNED', 'PICKED_UP', 'ON_ROAD'].includes(driverLoad.status),
  );
  const { data: trackPoints, error: trackError, isLoading: trackLoading, mutate: refreshTrack } = useWorkspaceQuery(
    selectedDriver?.id && driverLoad?.id ? ['driver-track', selectedDriver.id, driverLoad.id] : null,
    async (key) => {
      const previous = cache.get(unstable_serialize(key))?.data || [];
      const received = await fetchDriverTrack(key[1], key[2], previous.at(-1)?.captured_at || null);
      const byId = new Map(previous.map(point => [point.id, point]));
      received.forEach(point => byId.set(point.id, point));
      return [...byId.values()].sort((a, b) => a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id));
    },
    { staleTime: 60_000, refreshInterval: isVisible && isActiveLoad ? 120_000 : 0,
      revalidateOnFocus: isVisible, isPaused: () => !isVisible },
  );
  useEffect(() => {
    if (!isVisible) {
      hiddenAtRef.current = Date.now();
      return;
    }
    // Short navigation uses the cached track; a long absence catches up quietly.
    if (hiddenAtRef.current !== null) {
      const stale = Date.now() - hiddenAtRef.current >= 60_000;
      if (stale || sessions === undefined) void refreshSessions().catch(() => {});
      if (stale || trackPoints === undefined) void refreshTrack().catch(() => {});
    }
    hiddenAtRef.current = null;
  }, [isVisible, refreshSessions, refreshTrack, sessions, trackPoints]);
  const points = trackPoints || EMPTY_POINTS;
  const visibleTrack = { points, status: trackError ? 'error' : trackLoading ? 'loading' : 'ready' };

  return (
    <div className="fleet-map-workspace min-h-full w-full lg:h-full">
      <div className="grid min-h-full grid-cols-1 gap-3 lg:h-full lg:grid-cols-[minmax(390px,0.9fr)_minmax(0,1.1fr)]">
        <aside className="space-y-3 p-3 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{t('map.vehicles')}</h2>
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{drivers.length}</span>
            </div>
            {drivers.length === 0 && <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">{t('drivers.noDrivers')}</div>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-2">
              {drivers.map((driver) => {
                const selected = driver.id === selectedDriver?.id;
                return (
                  <button key={driver.id} type="button" onClick={() => setSelectedTruckId(driver.id)} className={`min-w-0 rounded-xl border p-2.5 text-left transition ${selected ? 'border-teal-500 bg-teal-50 shadow-sm dark:border-teal-700 dark:bg-teal-950/30' : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900'}`}>
                    <div className="flex items-center gap-2.5">
                      <DriverAvatar driver={driver} small />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold">{driver.name}</span>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${driver.isOnline ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                        </div>
                        <p className="truncate text-xs text-zinc-500">{driver.driverNumber}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedDriver && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                <DriverAvatar driver={selectedDriver} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-black text-zinc-900 dark:text-white">{selectedDriver.name}</h3>
                  <p className="mt-0.5 text-xs font-semibold text-zinc-500">{selectedDriver.driverNumber}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${selectedDriver.isOnline ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300'}`}>
                  <span className={`h-2 w-2 rounded-full ${selectedDriver.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                  {selectedDriver.isOnline ? t('common.online') : t('common.offline')}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2.5">
                <DriverFact icon={Phone} label={t('common.phone')} value={selectedDriver.phone || t('common.notProvided')} />
                <DriverFact icon={Clock3} label={t('drivers.lastSeen')} value={selectedDriver.lastSeenAt ? formatDateTime(selectedDriver.lastSeenAt) : t('drivers.neverSeen')} />
                <DriverFact icon={Truck} label={t('drivers.truck')} value={selectedDriver.truck || t('common.notProvided')} />
                <DriverFact icon={Hash} label={t('drivers.trailer')} value={selectedDriver.trailer || t('common.notProvided')} />
                <DriverFact icon={Gauge} label={t('drivers.hosRemaining')} value={selectedDriver.hos?.driveLeft || '—'} />
                <DriverFact icon={LocateFixed} label={t('drivers.location')} value={selectedDriver.currentLocation || t('map.noLocation')} />
              </dl>

              <LoadStatistics load={statisticsLoad} isCurrent={Boolean(currentLoad)} t={t} />

              {driverLoads.length > 0 ? (
                <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
                    {t('map.selectLoad')}
                    <select
                      className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-900 outline-none focus:border-teal-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      value={driverLoad?.id || ''}
                      onChange={(event) => setSelectedLoadId(event.target.value)}
                    >
                      {driverLoads.map((load) => (
                        <option key={load.id} value={load.id}>{load.loadNumber} · {load.status}</option>
                      ))}
                    </select>
                  </label>
                  {driverLoad && (
                    <div className="mt-3 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950/60">
                      <RouteStop marker="A" label={t('inbox.pickup')} stop={driverLoad.origin} />
                      <RouteStop marker="B" label={t('inbox.delivery')} stop={driverLoad.destination} />
                      <p className="flex items-start gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        <Route className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{visibleTrack.status === 'loading' ? t('map.trackLoading')
                          : visibleTrack.status === 'error' ? t('map.trackError')
                            : visibleTrack.points.length
                              ? t('map.trackPoints', { count: visibleTrack.points.length })
                              : t('map.noTrack')}</span>
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          )}
        </aside>

        <div className="relative min-h-[520px] overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:order-2 lg:h-full lg:min-h-0">
          <React.Suspense fallback={<div className="h-full min-h-[520px] w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" role="status"><span className="sr-only">{t('common.loading')}</span></div>}>
          <TrackingMap
            isVisible={isVisible}
            title={t('map.title')}
            routeKey={routeKey}
            points={visibleTrack.points}
            livePosition={isActiveLoad && hasCoordinates(selectedDriver)
              ? { lat: selectedDriver.lat, lng: selectedDriver.lng }
              : null}
          />
          </React.Suspense>
        </div>
      </div>
    </div>
  );
}

function LoadStatistics({ load, isCurrent, t }) {
  const stages = ['assigned', 'in_transit', 'delivered', 'completed'];
  const stageIndex = loadStageIndex(load);
  const statistics = knownLoadStatistics(load);
  const statusKey = load?.databaseStatus || load?.status?.toLowerCase();

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{isCurrent ? t('map.currentLoad') : t('map.selectedTrip')}</h4>
        {load && <span className="max-w-[55%] truncate rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800 dark:bg-teal-950/50 dark:text-teal-200">{load.loadNumber}</span>}
      </div>
      {!load ? (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/60">
          <PackageOpen className="h-5 w-5 shrink-0" />{t('map.noDriverLoad')}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('map.tripStage')}</span>
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{t(`loadStatus.${statusKey}`, { defaultValue: load.status })}</span>
          </div>
          {stageIndex !== null && (
            <div className="relative mt-3" aria-label={`${t('map.tripStage')}: ${t(`loadStatus.${statusKey}`, { defaultValue: load.status })}`}>
              <div className="absolute left-[12.5%] right-[12.5%] top-[5px] h-0.5 bg-zinc-200 dark:bg-zinc-700" />
              <div className="absolute left-[12.5%] top-[5px] h-0.5 bg-teal-500 transition-all" style={{ width: `${stageIndex * 25}%` }} />
              <div className="relative grid grid-cols-4 gap-1">
                {stages.map((stage, index) => (
                  <div key={stage} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                    <span className={`h-3 w-3 rounded-full border-2 ${index <= stageIndex ? 'border-teal-500 bg-teal-500 shadow-[0_0_0_3px_rgba(20,184,166,0.12)]' : 'border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'}`} />
                    <span className={`text-[10px] leading-3 ${index <= stageIndex ? 'font-semibold text-zinc-800 dark:text-zinc-200' : 'text-zinc-400'}`}>{t(`loadStatus.${stage}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <dl className="mt-4 grid grid-cols-3 gap-1.5">
            <LoadMetric icon={Route} label={t('loads.distance')} value={statistics.distance == null ? '—' : `${formatNumber(statistics.distance, { maximumFractionDigits: 1 })} mi`} />
            <LoadMetric icon={Scale} label={t('loads.weight')} value={statistics.weight == null ? '—' : `${formatNumber(statistics.weight)} lb`} />
            <LoadMetric icon={CircleDollarSign} label={t('loads.rate')} value={statistics.rate == null ? '—' : formatCurrency(statistics.rate)} />
          </dl>
          <p className="mt-2.5 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">{t('map.stageNotGpsProgress')}</p>
        </div>
      )}
    </div>
  );
}

function LoadMetric({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="flex items-center gap-1 truncate text-[10px] font-medium text-zinc-500 dark:text-zinc-400"><Icon className="h-3 w-3 shrink-0" />{label}</dt>
      <dd className="mt-1 truncate text-xs font-bold tabular-nums text-zinc-900 dark:text-white" title={value}>{value}</dd>
    </div>
  );
}

function DriverAvatar({ driver, small = false }) {
  const size = small ? 'h-9 w-9 rounded-lg text-xs' : 'h-12 w-12 rounded-xl text-sm';
  if (driver.avatar) return <img src={driver.avatar} alt="" className={`${size} shrink-0 object-cover`} />;
  const initials = driver.name?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'D';
  return <span className={`${size} grid shrink-0 place-items-center bg-zinc-100 font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-200`}>{initials}</span>;
}

function DriverFact({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-950/60">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400"><Icon className="h-3.5 w-3.5" />{label}</dt>
      <dd className="mt-1 break-words text-xs font-semibold text-zinc-800 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function RouteStop({ marker, label, stop }) {
  const address = stopAddress(stop);
  const appointment = stop?.appointmentAt || stop?.date;
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${marker === 'A' ? 'bg-teal-600' : 'bg-red-500'}`}>
        {marker}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{stop?.facility || `${stop?.city || '—'}${stop?.state ? `, ${stop.state}` : ''}`}</p>
        {address && <p className="mt-0.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400"><MapPin className="mr-1 inline h-3 w-3" />{address}</p>}
        {appointment && <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400"><Clock3 className="h-3 w-3" />{formatDateTime(appointment)}</p>}
      </div>
    </div>
  );
}
