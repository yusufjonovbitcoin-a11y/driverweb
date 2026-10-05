import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFleetRoute } from '../hooks/useFleetRoute';
import { fleetLivePosition, loadMapStops } from './fleetMapModel';
import TrackingMap from './TrackingMap';

const EMPTY_POINTS = [];

export default function LoadDetailsMap({ load, driver }) {
  const { t } = useTranslation();
  const [focusRequest, setFocusRequest] = useState(0);
  const containerRef = useRef(null);
  const [sizeKey, setSizeKey] = useState('');
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSizeKey(`${Math.round(width)}:${Math.round(height)}`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const stops = loadMapStops(load);
  const { route, loading, retry } = useFleetRoute(stops, true, true, load.id);
  const livePosition = fleetLivePosition(load, driver);
  const unavailable = route?.error || route?.data?.routingFailed;
  return <div ref={containerRef} className="h-full w-full">
    <TrackingMap title={t('map.title')} routeKey={`${load.id}:${sizeKey}`}
      mapStyle="mapbox://styles/mapbox/dark-v11" lineColor="#32d5ce"
      points={route?.data?.points || EMPTY_POINTS} routeStops={route?.data?.stops || stops}
      fitToStops locatingStops={loading} viewportPadding={{ top: 90, bottom: 90, left: 55, right: 55 }} focusRequest={focusRequest}
      livePosition={livePosition} liveMarkerIcon="truck" liveLabel={`${driver?.name || ''} · ${t('map.liveLocation')}`}
      pickupLabel={t('inbox.pickup')} deliveryLabel={t('inbox.delivery')} />
    <div className="load-command-map-label"><Route size={17} />{t('map.plannedRoute')}</div>
    <button type="button" className="load-command-recenter" title={t('map.centerRoute')} aria-label={t('map.centerRoute')}
      onClick={() => setFocusRequest(value => value + 1)}><LocateFixed size={19} /></button>
    {unavailable && <div className="load-command-route-error" role="status">{t('map.roadUnavailable')} <button type="button" onClick={retry}>{t('map.retry')}</button></div>}
    <div className="load-command-map-legend"><span><i />{t('inbox.pickup')}</span><span><i />{t('inbox.delivery')}</span>{livePosition && <span><i />{t('map.liveLocation')}</span>}</div>
  </div>;
}
