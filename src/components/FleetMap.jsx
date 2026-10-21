import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, LocateFixed, Route, Truck } from 'lucide-react';
import FleetDriverPicker from './FleetDriverPicker';
import { useWorkspaceQuery, useWorkspaceView } from '../hooks/WorkspaceCache';
import { useFleetRoute } from '../hooks/useFleetRoute';
import { fetchDriverTrack, fetchDriverTrackingSessions } from '../services/trackingService';
import { formatCurrency } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';
import { currentDriverLoad, knownLoadStatistics } from './mapLoadStatsModel';
import { mapboxLineFeatures } from './mapboxMapModel';
import { driverTrips, fleetLivePosition, isActiveFleetLoad, loadMapStops, overlayMapPadding, selectedDriverTrip, shouldRefreshCompletedTrack, stopCity, stopStreet } from './fleetMapModel';
import './fleet-map.css';

const TrackingMap = React.lazy(() => import('./TrackingMap'));
const LoadDetailsModal = React.lazy(() => import('./LoadDetailsModal'));
const EMPTY_POINTS = [];
const DEFAULT_PADDING = { top: 72, right: 52, left: 36, bottom: 44 };

function useMapOverlays(isVisible) {
  const canvasRef = useRef(null);
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
        const dock = dockRef.current?.getBoundingClientRect();
        canvasRef.current.style.setProperty('--fleet-map-dock-clearance', `${overlaps(dock) ? canvas.bottom - dock.top + 12 : 12}px`);
        const next = overlayMapPadding({ width: canvas.width, height: canvas.height,
          bottomPanelHeight: overlaps(dock) ? dock.height : 0 });
        setPadding(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    [canvasRef.current, dockRef.current].forEach(element => { if (element) observer?.observe(element); });
    window.addEventListener('resize', measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(frame); };
  }, [isVisible]);
  return { canvasRef, dockRef, padding };
}

export default function FleetMap({ drivers, loads, isVisible = true, onOpenDocs, onTrashLoad, onManageDocument }) {
  const { t } = useTranslation();
  const [selectedTruckId, setSelectedTruckId] = useWorkspaceView('map.driver', drivers[0]?.id || null);
  const [selectedLoadId, setSelectedLoadId] = useWorkspaceView('map.load', null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [detailsId, setDetailsId] = useState(null);
  const { canvasRef, dockRef, padding } = useMapOverlays(isVisible);
  const selectedDriver = drivers.find(driver => driver.id === selectedTruckId) || drivers[0];
  const hiddenAtRef = useRef(null);
  const previousTripRef = useRef(null);
  const { data: sessions, mutate: refreshSessions } = useWorkspaceQuery(
    selectedDriver?.id ? ['driver-sessions', selectedDriver.id] : null,
    ([, driverId]) => fetchDriverTrackingSessions(driverId),
    { staleTime: 60_000, refreshInterval: isVisible ? 120_000 : 0,
      revalidateOnFocus: isVisible, isPaused: () => !isVisible },
  );
  const trips = useMemo(() => driverTrips(loads, selectedDriver?.id, sessions || EMPTY_POINTS), [loads, selectedDriver?.id, sessions]);
  const currentLoad = currentDriverLoad(trips, selectedDriver?.id);
  const selectedTrip = selectedDriverTrip(trips, currentLoad, selectedLoadId);
  const history = trips.filter(load => load.id !== currentLoad?.id);
  const isCurrentTrip = Boolean(currentLoad && selectedTrip?.id === currentLoad.id);
  const isActiveLoad = isActiveFleetLoad(selectedTrip, selectedDriver);
  // Completion changes the GPS overlay, not the pickup/delivery road route.
  const routeKey = `${selectedDriver?.id || ''}:${selectedTrip?.id || ''}`;
  const { data: trackPoints, mutate: refreshTrack } = useWorkspaceQuery(
    selectedDriver?.id && selectedTrip?.id ? ['driver-track', selectedDriver.id, selectedTrip.id] : null,
    // Offline batches can arrive with arbitrarily old captured_at values.
    // Reconcile the complete paged track; capture time is not an ingest cursor.
    (key) => fetchDriverTrack(key[1], key[2]),
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
    if (shouldRefreshCompletedTrack(previous, {
      driverId: selectedDriver?.id, loadId: selectedTrip?.id,
      isActive: isActiveLoad, isVisible,
    })) void refreshTrack().catch(() => {});
    previousTripRef.current = { driver: selectedDriver?.id, load: selectedTrip?.id, active: isActiveLoad };
  }, [selectedDriver?.id, selectedTrip?.id, isActiveLoad, isVisible, refreshTrack]);

  const routeStops = loadMapStops(selectedTrip);
  const { route: roadRoute, loading: roadLoading } = useFleetRoute(routeStops, true, Boolean(selectedTrip && isVisible), routeKey);
  const mapStops = roadRoute?.data?.stops || routeStops;
  const points = trackPoints || EMPTY_POINTS;
  const livePosition = fleetLivePosition(selectedTrip, selectedDriver, points);
  const linePoints = roadRoute?.data?.points || EMPTY_POINTS;
  const recordedFeatures = useMemo(() => isActiveLoad ? [] : mapboxLineFeatures(points, true), [isActiveLoad, points]);
  const statistics = knownLoadStatistics(selectedTrip);
  const detailsLoad = trips.find(load => load.id === detailsId);
  const closeDetails = useCallback(() => setDetailsId(null), []);
  const chooseDriver = (driverId) => {
    setSelectedTruckId(driverId);
    setSelectedLoadId(null);
    setDetailsId(null);
  };

  return (
    <div className="fleet-map-workspace">
      <div ref={canvasRef} className="fleet-map-canvas">
        <React.Suspense fallback={<div className="fleet-map-loading" role="status">{t('common.loading')}</div>}>
          <TrackingMap isVisible={isVisible} title={t('map.title')} routeKey={routeKey}
            fitToStops locatingStops={roadLoading}
            points={linePoints} recordedFeatures={recordedFeatures} routeStops={mapStops} lineColor="#078b8c" viewportPadding={padding} focusRequest={focusRequest}
            liveMarkerIcon="truck" liveLabel={`${selectedDriver?.name || t('drivers.driver')} · ${t(livePosition?.source !== 'live' ? 'map.lastLocation' : 'map.liveLocation')}`}
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
          {livePosition && <span>{t(livePosition.source !== 'live' ? 'map.lastLocation' : 'map.liveLocation')}</span>}
        </div>}
        <button type="button" className="fleet-map-recenter" aria-label={t('map.centerRoute')} title={t('map.centerRoute')}
          onClick={() => setFocusRequest(value => value + 1)}><LocateFixed size={19} /></button>
      </div>

      <section ref={dockRef} className="fleet-map-dock" aria-label={t('map.selectedTrip')}>
        <div className="fleet-map-driver">
          <FleetDriverPicker drivers={drivers} selectedDriver={selectedDriver} onSelect={chooseDriver} isVisible={isVisible} />
        </div>
        <div className="fleet-map-load">
          <span className="sr-only">{t(isCurrentTrip ? 'map.currentLoad' : 'map.selectedTrip')}</span>
          <strong className="fleet-map-load-number" title={selectedTrip?.loadNumber}>{selectedTrip?.loadNumber || '—'}</strong>
          <strong className="fleet-map-rate">{statistics.rate === null ? '—' : formatCurrency(statistics.rate)}</strong>
          <span className="fleet-map-load-meta" title={[selectedTrip?.broker, selectedTrip?.equipment].filter(Boolean).join(' · ')}><Truck size={12} aria-hidden="true" />{[selectedTrip?.broker, selectedTrip?.equipment].filter(Boolean).join(' · ') || '—'}</span>
        </div>
        <div className="fleet-map-dock-route">
          {selectedTrip ? <div className={`fleet-map-stop-strip${mapStops.length > 2 ? ' is-multi-stop' : ''}`} tabIndex={0} role="region" aria-label={`${t('map.routeStops')}: ${mapStops.length}`}>{mapStops.map((stop, index) => <React.Fragment key={stop.sequence}>
            {index > 0 && <ArrowRight className="fleet-map-stop-arrow" size={17} aria-hidden="true" />}
            <DockStop stop={stop} marker={stop.markerLabel} label={t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')} />
          </React.Fragment>)}</div>
            : <p className="fleet-map-no-load">{t('map.noDriverLoad')}</p>}
        </div>
        <div className="fleet-map-dock-action">
          {selectedTrip && <span className="fleet-map-trip-status">{loadStatusLabel(t, selectedTrip.databaseStatus || selectedTrip.status)}</span>}
          <button type="button" disabled={!selectedTrip} onClick={() => setDetailsId(selectedTrip.id)}>{t('map.openTrip')}<ArrowRight size={17} /></button>
        </div>
      </section>
      {detailsLoad && <React.Suspense fallback={<div className="fleet-map-details-loading" role="status">{t('common.loading')}</div>}>
        <LoadDetailsModal load={detailsLoad} driver={selectedDriver} onClose={closeDetails} onTrashLoad={onTrashLoad} onManageDocument={onManageDocument}
          onOpenDocs={onOpenDocs} />
      </React.Suspense>}
    </div>
  );
}

function DockStop({ stop, marker, label }) {
  return <div className="fleet-map-dock-stop"><span className={`fleet-map-stop-marker ${stop.role === 'delivery' ? 'marker-b' : ''}`} aria-hidden="true">{marker}</span>
    <div><span className="fleet-map-stop-label">{label}</span><strong title={stopCity(stop)}>{stopCity(stop)}</strong><p title={stopStreet(stop)}>{stopStreet(stop) || '—'}</p></div>
  </div>;
}
