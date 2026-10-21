import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Layers, MapPinned } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TrackingMap from './TrackingMap';
import { loadGoogleMapsRoutes } from './loadGoogleMapsModel.js';

const EMPTY_POINTS = [];
const MAP_STYLES = ['streets-v12', 'satellite-streets-v12', 'light-v11', 'dark-v11'];

export default function LoadDetailsMap({ load, driver, location, pickupRoute, roadRoute, stops }) {
  const { t } = useTranslation();
  const [mapStyle, setMapStyle] = useState('streets-v12');
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const containerRef = useRef(null);
  const [sizeKey, setSizeKey] = useState('');
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      element.style.setProperty('--load-map-menu-height', `${Math.max(0, height - 90)}px`);
      setSizeKey(`${Math.round(width)}:${Math.round(height)}`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { route, loading, retry } = roadRoute;
  const livePosition = location;
  const unavailable = route?.error || route?.data?.routingFailed;
  const googleRoutes = loadGoogleMapsRoutes(stops);
  return <div ref={containerRef} className="relative h-full w-full">
    <TrackingMap key={mapStyle} title={t('map.title')} routeKey={`${load.id}:${sizeKey}`}
      mapStyle={`mapbox://styles/mapbox/${mapStyle}`} lineColor={mapStyle === 'dark-v11' || mapStyle === 'satellite-streets-v12' ? '#2dd4bf' : '#008573'}
      deadheadPoints={pickupRoute?.route?.data?.points || EMPTY_POINTS}
      points={route?.data?.points || EMPTY_POINTS} routeStops={route?.data?.stops || stops}
      fitToStops={!livePosition} locatingStops={loading} viewportPadding={{ top: 65, bottom: 65, left: 40, right: 40 }} focusRequest={focusRequest}
      livePosition={livePosition} liveMarkerIcon="truck" liveLabel={`${driver?.name || ''} · ${t(location?.stale ? 'map.locationStale' : 'map.lastKnownLocation')}`}
      pickupLabel={t('inbox.pickup')} deliveryLabel={t('inbox.delivery')} />
    {googleRoutes.length === 1 ? <a className="load-command-open-map" href={googleRoutes[0].url} target="_blank" rel="noopener noreferrer" title={t('map.openGoogleRoute')} aria-label={t('map.openGoogleRoute')}><MapPinned size={20} aria-hidden="true" /></a>
      : googleRoutes.length > 1 ? <details className="load-command-map-routes" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
      }}><summary className="load-command-open-map" title={t('map.openGoogleRoute')} aria-label={t('map.openGoogleRoute')}><MapPinned size={20} aria-hidden="true" /></summary>
        <nav aria-label={t('map.googleRouteParts')}><p>{t('map.googleRouteSplit')}</p>{googleRoutes.map((part, index) => <a key={part.url} href={part.url} target="_blank" rel="noopener noreferrer">{t('map.googleRoutePart', { number: index + 1, from: part.from, to: part.to })}</a>)}</nav>
      </details> : <button type="button" className="load-command-open-map" disabled title={t('map.googleRouteUnavailable')} aria-label={t('map.googleRouteUnavailable')}><MapPinned size={20} aria-hidden="true" /></button>}
    <button type="button" className="load-command-recenter" title={t('map.centerRoute')} aria-label={t('map.centerRoute')}
      onClick={() => setFocusRequest(value => value + 1)}><LocateFixed size={19} /></button>
    <button type="button" className="load-command-recenter load-map-theme" title={t('map.stylePicker')} aria-label={t('map.stylePicker')} aria-expanded={stylePickerOpen}
      onClick={() => setStylePickerOpen(value => !value)}><Layers size={19} /></button>
    {stylePickerOpen && <div className="load-map-styles" role="group" aria-label={t('map.stylePicker')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setStylePickerOpen(false); } }}>
      {MAP_STYLES.map(style => <button type="button" key={style} aria-pressed={style === mapStyle} onClick={() => { setMapStyle(style); setStylePickerOpen(false); }}>{t(`map.styles.${style}`)}</button>)}
    </div>}
    {unavailable && <div className="load-command-route-error" role="status">{t('map.roadUnavailable')} <button type="button" onClick={retry}>{t('map.retry')}</button></div>}
  </div>;
}
