import React, { useEffect, useMemo, useRef, useState } from 'react';
import { unstable_serialize, useSWRConfig } from 'swr';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, ChevronDown, ChevronRight, ChevronUp, History, LocateFixed, Route, Search, Truck, X } from 'lucide-react';
import { useWorkspaceQuery, useWorkspaceView } from '../hooks/WorkspaceCache';
import { useFleetRoute } from '../hooks/useFleetRoute';
import { fetchDriverTrack, fetchDriverTrackingSessions } from '../services/trackingService';
import { formatCurrency, formatDate } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';
import { currentDriverLoad, knownLoadStatistics } from './mapLoadStatsModel';
import { mapboxLineFeatures, validMapCoordinate } from './mapboxMapModel';
import { driverTrips, filteredTrips, fleetLivePosition, isActiveFleetLoad, loadMapStops, overlayMapPadding, selectedDriverTrip, stopCity, stopStreet, tripTimestamp } from './fleetMapModel';
import './fleet-map.css';

const TrackingMap = React.lazy(() => import('./TrackingMap'));
const LoadDetailsModal = React.lazy(() => import('./LoadDetailsModal'));
const EMPTY_POINTS = [];
const DEFAULT_PADDING = { top: 72, right: 52, left: 36, bottom: 44 };

function useMapOverlays(isVisible) {
  const canvasRef = useRef(null);
  const paletteRef = useRef(null);
  const dockRef = useRef(null);
  const [padding, setPadding] = useState(DEFAULT_PADDING);
  useEffect(() => {
    if (!isVisible) return undefined;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = canvasRef.current?.getBoundingClientRect();
        if (!canvas?.width || !canvas?.height) return;
        const overlaps = rect => rect && rect.left < canvas.right && rect.right > canvas.left
          && rect.top < canvas.bottom && rect.bottom > canvas.top;
        const palette = paletteRef.current?.getBoundingClientRect();
        const dock = dockRef.current?.getBoundingClientRect();
        const next = overlayMapPadding({ width: canvas.width, height: canvas.height,
          leftPanelWidth: overlaps(palette) ? palette.width : 0,
          bottomPanelHeight: overlaps(dock) ? dock.height : 0 });
        setPadding(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    [canvasRef.current, paletteRef.current, dockRef.current].forEach(element => { if (element) observer?.observe(element); });
    window.addEventListener('resize', measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(frame); };
  }, [isVisible]);
  return { canvasRef, paletteRef, dockRef, padding };
}

export default function FleetMap({ drivers, loads, isVisible = true, onOpenDocs }) {
  const { t } = useTranslation();
  const [selectedTruckId, setSelectedTruckId] = useWorkspaceView('map.driver', drivers[0]?.id || null);
  const [selectedLoadId, setSelectedLoadId] = useWorkspaceView('map.load', null);
  const [query, setQuery] = useWorkspaceView('map.search', '');
  const [period, setPeriod] = useWorkspaceView('map.period', 'all');
  const [collapsed, setCollapsed] = useWorkspaceView('map.historyCollapsed', false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [detailsId, setDetailsId] = useState(null);
  const { canvasRef, paletteRef, dockRef, padding } = useMapOverlays(isVisible);
  const { cache } = useSWRConfig();
  const selectedDriver = drivers.find(driver => driver.id === selectedTruckId) || drivers[0];
  const hiddenAtRef = useRef(null);
  const previousTripRef = useRef(null);
  const { data: sessions, error: sessionsError, isLoading: sessionsLoading, mutate: refreshSessions } = useWorkspaceQuery(
    selectedDriver?.id ? ['driver-sessions', selectedDriver.id] : null,
    ([, driverId]) => fetchDriverTrackingSessions(driverId),
    { staleTime: 60_000, refreshInterval: isVisible ? 120_000 : 0,
      revalidateOnFocus: isVisible, isPaused: () => !isVisible },
  );
  const trips = useMemo(() => driverTrips(loads, selectedDriver?.id, sessions || EMPTY_POINTS), [loads, selectedDriver?.id, sessions]);
  const currentLoad = currentDriverLoad(trips, selectedDriver?.id);
  const selectedTrip = selectedDriverTrip(trips, currentLoad, selectedLoadId);
  const history = trips.filter(load => load.id !== currentLoad?.id);
  const hasFilters = Boolean(query.trim() || period !== 'all');
  const results = filteredTrips(hasFilters ? trips : history, { query, period, sessions: sessions || EMPTY_POINTS });
  const isCurrentTrip = Boolean(currentLoad && selectedTrip?.id === currentLoad.id);
  const isActiveLoad = isActiveFleetLoad(selectedTrip, selectedDriver);
  // Completion changes the GPS overlay, not the pickup/delivery road route.
  const routeKey = `${selectedDriver?.id || ''}:${selectedTrip?.id || ''}`;
  const { data: trackPoints, error: trackError, isLoading: trackLoading, mutate: refreshTrack } = useWorkspaceQuery(
    selectedDriver?.id && selectedTrip?.id ? ['driver-track', selectedDriver.id, selectedTrip.id] : null,
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
    if (!isVisible) { hiddenAtRef.current = Date.now(); return; }
    // Keep the existing private in-memory cache and catch-up policy.
    if (hiddenAtRef.current !== null) {
      const stale = Date.now() - hiddenAtRef.current >= 60_000;
      if (stale || sessions === undefined) void refreshSessions().catch(() => {});
      if (stale || trackPoints === undefined) void refreshTrack().catch(() => {});
    }
    hiddenAtRef.current = null;
  }, [isVisible, refreshSessions, refreshTrack, sessions, trackPoints]);
  useEffect(() => {
    const previous = previousTripRef.current;
    if (isVisible && previous?.driver === selectedDriver?.id && previous?.load === selectedTrip?.id
      && previous.active && !isActiveLoad) void refreshTrack().catch(() => {});
    previousTripRef.current = { driver: selectedDriver?.id, load: selectedTrip?.id, active: isActiveLoad };
  }, [selectedDriver?.id, selectedTrip?.id, isActiveLoad, isVisible, refreshTrack]);

  const routeStops = loadMapStops(selectedTrip);
  const { route: roadRoute, loading: roadLoading, retry: retryRoad } = useFleetRoute(routeStops, true, Boolean(selectedTrip && isVisible), routeKey);
  const mapStops = roadRoute?.data?.stops || routeStops;
  const points = trackPoints || EMPTY_POINTS;
  const livePosition = fleetLivePosition(selectedTrip, selectedDriver, points);
  const linePoints = roadRoute?.data?.points || EMPTY_POINTS;
  const recordedFeatures = useMemo(() => isActiveLoad ? [] : mapboxLineFeatures(points, true), [isActiveLoad, points]);
  const unresolvedStops = mapStops.filter(stop => !validMapCoordinate(stop.latitude, stop.longitude));
  const roadUnavailable = Boolean(roadRoute?.error || roadRoute?.data?.routingFailed);
  const statistics = knownLoadStatistics(selectedTrip);
  const detailsLoad = trips.find(load => load.id === detailsId);
  const trackMessage = trackLoading ? t('map.trackLoading') : trackError ? t('map.trackError')
    : points.length ? t('map.trackPoints', { count: points.length }) : t('map.noTrack');
  const chooseDriver = (event) => {
    setSelectedTruckId(event.target.value);
    setSelectedLoadId(null);
    setQuery('');
    setPeriod('all');
    setDetailsId(null);
  };

  return (
    <div className="fleet-map-workspace">
      <div ref={canvasRef} className="fleet-map-canvas">
        <React.Suspense fallback={<div className="fleet-map-loading" role="status">{t('common.loading')}</div>}>
          <TrackingMap isVisible={isVisible} title={t('map.title')} routeKey={routeKey}
            fitToStops locatingStops={roadLoading}
            points={linePoints} recordedFeatures={recordedFeatures} routeStops={mapStops} lineColor="#078b8c" viewportPadding={padding} focusRequest={focusRequest}
            liveMarkerIcon="truck" liveLabel={`${selectedDriver?.name || t('drivers.driver')} · ${t(livePosition?.source === 'recorded' ? 'map.lastLocation' : 'map.liveLocation')}`}
            pickupLabel={t('inbox.pickup')} deliveryLabel={t('inbox.delivery')}
            livePosition={livePosition} />
        </React.Suspense>
        <div className="fleet-map-mode" role="group" aria-label={t('map.selectLoad')}>
          <button type="button" className={isCurrentTrip ? 'is-active' : ''} aria-pressed={isCurrentTrip}
            disabled={!currentLoad} onClick={() => setSelectedLoadId(currentLoad.id)}>{t('map.currentTrip')}</button>
          <button type="button" className={selectedTrip && !isCurrentTrip ? 'is-active' : ''} aria-pressed={Boolean(selectedTrip && !isCurrentTrip)}
            disabled={!history.length} onClick={() => setSelectedLoadId(history.find(load => load.id === selectedLoadId)?.id || history[0].id)}>{t('map.historyMode')}</button>
        </div>
        {selectedTrip && <div className="fleet-map-route-chip"><Route size={15} />
          <strong className="fleet-map-road-legend">{t('map.plannedRoute')}</strong>
          {recordedFeatures.length > 0 && <strong className="fleet-map-gps-legend">{t('map.recordedRoute')}</strong>}
          {livePosition && <span>{t(livePosition.source === 'recorded' ? 'map.lastLocation' : 'map.liveLocation')}</span>}
        </div>}
        <button type="button" className="fleet-map-recenter" aria-label={t('map.centerRoute')} title={t('map.centerRoute')}
          onClick={() => setFocusRequest(value => value + 1)}><LocateFixed size={19} /></button>
      </div>

      <aside ref={paletteRef} className={`fleet-map-palette${collapsed ? ' is-collapsed' : ''}`} aria-label={t('map.workspaceTitle')}>
        <header className="fleet-map-palette-heading">
          <div><h1>{t('map.workspaceTitle')}</h1><p>{t('map.workspaceDescription')}</p></div>
          <button type="button" className="fleet-map-icon-button" aria-label={t(collapsed ? 'map.expandHistory' : 'map.collapseHistory')}
            aria-expanded={!collapsed} aria-controls="fleet-trip-history" onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </header>
        <div className="fleet-map-filters">
          <label className="fleet-map-search"><Search size={18} aria-hidden="true" />
            <span className="sr-only">{t('map.tripSearch')}</span>
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('map.tripSearch')} />
            {query && <button type="button" onClick={() => setQuery('')} aria-label={t('map.clearSearch')}><X size={15} /></button>}
          </label>
          <label className="fleet-map-date-filter"><CalendarDays size={17} aria-hidden="true" />
            <span className="sr-only">{t('drivers.allDates')}</span>
            <select value={period} onChange={event => setPeriod(event.target.value)}>
              <option value="all">{t('drivers.allDates')}</option><option value="7">{t('map.last7Days')}</option><option value="30">{t('map.last30Days')}</option>
            </select><ChevronDown size={15} aria-hidden="true" />
          </label>
        </div>
        <section id="fleet-trip-history" className="fleet-map-history" hidden={collapsed}>
          <div className="fleet-map-history-heading"><h2>{t(hasFilters ? 'map.searchResults' : 'map.selectLoad')}</h2><span>{results.length}</span></div>
          {sessionsError && <div className="fleet-map-session-error" role="status">{t('map.historyError')}
            <button type="button" onClick={() => void refreshSessions().catch(() => {})}>{t('map.retry')}</button>
          </div>}
          <div className="fleet-map-history-list">
            {results.map(load => <HistoryTrip key={load.id} load={load} selected={load.id === selectedTrip?.id}
              date={tripTimestamp(load, sessions || EMPTY_POINTS)} onSelect={() => setSelectedLoadId(load.id)} t={t} />)}
            {!results.length && <div className="fleet-map-history-empty"><History size={25} />
              <p>{sessionsLoading ? t('common.loading') : t(hasFilters ? 'map.noSearchResults' : 'map.noHistory')}</p>
              {hasFilters && <button type="button" onClick={() => { setQuery(''); setPeriod('all'); }}>{t('map.resetFilters')}</button>}
            </div>}
          </div>
        </section>
        {selectedTrip && <details className="fleet-map-selected-stops">
          <summary>{t('map.routeStops')} <span>{mapStops.length}</span></summary>
          <ol>{mapStops.map(stop => <li key={stop.sequence}>
            <span className={`fleet-map-stop-marker ${stop.role === 'delivery' ? 'marker-b' : ''}`}>{stop.markerLabel}</span>
            <div><strong>{t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')} · {stopCity(stop)}</strong>
              <p>{stopStreet(stop) || '—'}</p>
            </div>
          </li>)}</ol>
        </details>}
        {!collapsed && <footer className="fleet-map-palette-footer">
          <div role="status">
            <span>{selectedTrip ? t(roadLoading ? 'map.roadLoading' : roadUnavailable ? 'map.roadUnavailable' : 'map.plannedRoute') : t('map.noDriverLoad')}</span>
            {selectedTrip && !isActiveLoad && <span>{trackMessage}</span>}
            {selectedTrip && !roadLoading && unresolvedStops.length > 0 && <span>{t('map.unlocatedStops', { count: unresolvedStops.length })}</span>}
            {isActiveLoad && <span>{t(!livePosition ? 'map.liveUnavailable' : livePosition.source === 'live' ? 'map.liveLocation' : 'map.lastLocation')}</span>}
          </div>
          {(roadUnavailable || unresolvedStops.length > 0) && !roadLoading && <button type="button" onClick={retryRoad}>{t('map.retry')}</button>}
          {!isActiveLoad && trackError && <button type="button" onClick={() => void refreshTrack().catch(() => {})}>{t('map.retry')}</button>}
        </footer>}
      </aside>

      <section ref={dockRef} className="fleet-map-dock" aria-label={t('map.selectedTrip')}>
        <div className="fleet-map-driver">
          <label htmlFor="fleet-driver-picker" className="fleet-map-eyebrow">{t('drivers.driver')}</label>
          <div className="fleet-map-driver-picker"><DriverAvatar driver={selectedDriver} />
            <div><select id="fleet-driver-picker" value={selectedDriver?.id || ''} onChange={chooseDriver} disabled={!drivers.length}>
              {!drivers.length && <option value="">{t('drivers.noDrivers')}</option>}
              {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
            </select><p title={selectedDriver?.truck || ''}>{[selectedDriver?.driverNumber, selectedDriver?.truck].filter(Boolean).join(' · ') || '—'}</p></div>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
          {selectedDriver && <span className={`fleet-map-presence${selectedDriver.isOnline ? ' is-online' : ''}`}><i />{t(selectedDriver.isOnline ? 'common.online' : 'common.offline')}</span>}
        </div>
        <div className="fleet-map-load">
          <span className="fleet-map-eyebrow">{t(isCurrentTrip ? 'map.currentLoad' : 'map.selectedTrip')}</span>
          <strong className="fleet-map-load-number">{selectedTrip?.loadNumber || '—'}</strong>
          <span className="fleet-map-broker" title={selectedTrip?.broker || ''}>{selectedTrip?.broker || t('common.notProvided')}</span>
          <span className="fleet-map-equipment"><Truck size={13} />{selectedTrip?.equipment || '—'}</span>
        </div>
        <div className="fleet-map-dock-route">
          {selectedTrip ? <div className="fleet-map-stop-strip" tabIndex={0} role="region" aria-label={t('map.routeStops')}>{mapStops.map((stop, index) => <React.Fragment key={stop.sequence}>
            {index > 0 && <ArrowRight className="fleet-map-stop-arrow" size={17} aria-hidden="true" />}
            <DockStop stop={stop} marker={stop.markerLabel} label={t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')} />
          </React.Fragment>)}</div>
            : <p className="fleet-map-no-load">{t('map.noDriverLoad')}</p>}
        </div>
        <div className="fleet-map-dock-action">
          <strong>{statistics.rate === null ? '—' : formatCurrency(statistics.rate)}</strong>
          {selectedTrip && <span className="fleet-map-trip-status">{loadStatusLabel(t, selectedTrip.databaseStatus || selectedTrip.status)}</span>}
          <button type="button" disabled={!selectedTrip} onClick={() => setDetailsId(selectedTrip.id)}>{t('map.openTrip')}<ArrowRight size={17} /></button>
        </div>
      </section>
      {detailsLoad && <React.Suspense fallback={<div className="fleet-map-details-loading" role="status">{t('common.loading')}</div>}>
        <LoadDetailsModal load={detailsLoad} driver={selectedDriver} onClose={() => setDetailsId(null)}
          onOpenDocs={(load, documentId) => { setDetailsId(null); onOpenDocs?.(load, documentId); }} />
      </React.Suspense>}
    </div>
  );
}

function HistoryTrip({ load, selected, date, onSelect, t }) {
  return <button type="button" className={`fleet-map-trip${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="fleet-map-trip-dot" aria-hidden="true" />
    <span className="fleet-map-trip-body"><span className="fleet-map-trip-heading"><strong>{load.loadNumber}</strong>
      <time dateTime={date === null ? undefined : new Date(date).toISOString()}>{date === null ? '—' : formatDate(date, { day: 'numeric', month: 'short' })}</time></span>
      <span className="fleet-map-trip-route">{stopCity(load.origin)} <ArrowRight size={12} /> {stopCity(load.destination)}</span>
      <span className="fleet-map-trip-status">{loadStatusLabel(t, load.databaseStatus || load.status)}</span>
    </span><ChevronRight size={17} aria-hidden="true" />
  </button>;
}

function DriverAvatar({ driver }) {
  if (driver?.avatar) return <img className="fleet-map-avatar" src={driver.avatar} alt="" />;
  const initials = driver?.name?.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—';
  return <span className="fleet-map-avatar" aria-hidden="true">{initials}</span>;
}

function DockStop({ stop, marker, label }) {
  return <div className="fleet-map-dock-stop"><span className={`fleet-map-stop-marker ${stop.role === 'delivery' ? 'marker-b' : ''}`} aria-hidden="true">{marker}</span>
    <div><span className="fleet-map-stop-label">{label}</span><strong title={stopCity(stop)}>{stopCity(stop)}</strong><p title={stopStreet(stop)}>{stopStreet(stop) || '—'}</p></div>
  </div>;
}
