import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { mapFailureState } from './mapHealth.js';
import {
  buildMapboxGeometry,
  DEFAULT_MAP_CENTER,
  mapboxFocusPoints,
  mapboxLineFeatures,
  shouldFitMapbox,
  validMapCoordinate,
  validMapStops,
} from './mapboxMapModel';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const MAPBOX_STYLE = import.meta.env.VITE_MAPBOX_STYLE_URL?.trim()
  || 'mapbox://styles/mapbox/streets-v12';
const EMPTY_FEATURES = [];

function markerElement(color, label, title = label, icon = null, interactive = false) {
  const element = document.createElement(interactive ? 'button' : 'span');
  if (interactive) element.type = 'button';
  element.title = title;
  element.setAttribute('aria-label', title);
  if (icon === 'truck') {
    element.style.cssText = `display:grid;place-items:center;width:30px;height:23px;border:2px solid white;border-radius:6px;background:#172334;color:white;box-shadow:0 2px 9px #0007`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '19');
    svg.setAttribute('height', '19');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    ['M10 17h4V5H2v12h3', 'M14 9h4l4 4v4h-3', 'M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0', 'M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0']
      .forEach(data => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', data);
        svg.append(path);
      });
    element.append(svg);
  } else {
    element.textContent = label;
    element.style.cssText = `display:grid;place-items:center;width:32px;height:32px;padding:0;border:3px solid white;border-radius:50%;background:${color};color:white;font:700 10px/1 system-ui;box-shadow:0 2px 9px #0006`;
  }
  return element;
}

function stopPopup(stop, title) {
  const content = document.createElement('div');
  content.style.cssText = 'color:#172c3a;font:12px/1.5 system-ui;max-width:240px';
  const heading = document.createElement('strong');
  heading.textContent = title;
  content.append(heading);
  for (const text of [stop.facility, stop.address, [stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ')].filter(Boolean)) {
    const line = document.createElement('div');
    line.textContent = text;
    content.append(line);
  }
  return content;
}

function clearMarkers(markers) {
  markers.forEach((item) => item.remove());
  markers.length = 0;
}

export default function TrackingMap({ points, deadheadPoints, livePosition, routeKey, title, routeStops,
  lineColor = '#2563eb', liveMarkerText = 'D', liveMarkerIcon = null,
  pickupLabel = 'A', deliveryLabel = 'B', liveLabel = 'D', isVisible = true,
  viewportPadding = 70, focusRequest = 0, recordedLine = false,
  fitToStops = false, locatingStops = false, recordedFeatures = EMPTY_FEATURES, mapStyle = MAPBOX_STYLE }) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const liveMarkerRef = useRef(null);
  const liveMarkerStyleRef = useRef(null);
  const fittedRouteRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [resourceError, setResourceError] = useState(false);
  const [retry, setRetry] = useState(0);
  const liveLatitude = livePosition?.lat;
  const liveLongitude = livePosition?.lng;
  const geometry = useMemo(() => buildMapboxGeometry(points), [points]);
  const lineFeatures = useMemo(() => mapboxLineFeatures(points, recordedLine), [points, recordedLine]);
  const deadhead = useMemo(() => buildMapboxGeometry(deadheadPoints || []), [deadheadPoints]);
  const stops = useMemo(() => validMapStops(routeStops), [routeStops]);
  const paddingKey = JSON.stringify(viewportPadding);
  const live = useMemo(() => validMapCoordinate(liveLatitude, liveLongitude)
    ? { lat: Number(liveLatitude), lng: Number(liveLongitude) }
    : null, [liveLatitude, liveLongitude]);
  const waitingForStops = fitToStops && locatingStops && stops.length === 0;

  useEffect(() => {
    const markers = markersRef.current;
    if (!MAPBOX_TOKEN || !containerRef.current) {
      setStatus('error');
      return undefined;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    fittedRouteRef.current = null;
    setStatus('loading');
    setResourceError(false);
    let loaded = false;
    let map;
    try { map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapStyle,
      projection: 'mercator',
      center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat],
      zoom: 5,
      attributionControl: true,
    }); } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- reflect external WebGL initialization failure.
      setStatus('error');
      return undefined;
    }
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.on('load', () => {
      map.addSource('driver-track', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'driver-track-line',
        type: 'line',
        source: 'driver-track',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 5, 'line-opacity': 0.92 },
      });
      map.addSource('driver-deadhead', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'driver-deadhead-line', type: 'line', source: 'driver-deadhead',
        paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-dasharray': [2, 2] } });
      map.addSource('driver-recorded', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'driver-recorded-line', type: 'line', source: 'driver-recorded',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-dasharray': [2, 1.5], 'line-opacity': 0.95 } });
      loaded = true;
      setResourceError(false);
      setStatus('ready');
    });
    map.on('error', () => {
      const next = mapFailureState(loaded);
      setStatus(next.status);
      setResourceError(next.resourceError);
    });
    map.on('idle', () => { if (loaded) setResourceError(false); });
    mapRef.current = map;

    return () => {
      clearMarkers(markers);
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      liveMarkerStyleRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [retry, mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!isVisible) {
      map.stop();
      fittedRouteRef.current = null;
      return undefined;
    }
    let frame;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container?.clientWidth && container?.clientHeight) map.resize();
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (containerRef.current) observer?.observe(containerRef.current);
    resize();
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [isVisible, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isVisible || status !== 'ready' || !map) return;
    map.getSource('driver-deadhead')?.setData({ type: 'FeatureCollection', features: deadhead.lineCoordinates.length < 2 ? [] : [{
      type: 'Feature', geometry: { type: 'LineString', coordinates: deadhead.lineCoordinates }, properties: {},
    }] });
    map.setPaintProperty('driver-track-line', 'line-color', lineColor);
    map.getSource('driver-track')?.setData({
      type: 'FeatureCollection',
      features: lineFeatures,
    });
    map.getSource('driver-recorded')?.setData({ type: 'FeatureCollection', features: recordedFeatures });
    clearMarkers(markersRef.current);

    if (routeStops?.length) {
      stops.forEach(stop => {
        const label = stop.markerLabel || (routeStops.length > 2 ? String(stop.sequence) : stop.role === 'pickup' ? 'A' : 'B');
        const title = `${label} · ${stop.role === 'pickup' ? pickupLabel : deliveryLabel}`;
        markersRef.current.push(new mapboxgl.Marker({ element: markerElement(stop.role === 'pickup' ? '#008573' : '#ef4444', label, title, null, true) })
          .setLngLat([stop.longitude, stop.latitude])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setDOMContent(stopPopup(stop, title))).addTo(map));
      });
    } else if (geometry.start) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#008573', 'A', pickupLabel) })
        .setLngLat([geometry.start.lng, geometry.start.lat]).addTo(map));
    }
    if (!routeStops?.length && geometry.end && geometry.path.length > 1) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#ef4444', 'B', deliveryLabel) })
        .setLngLat([geometry.end.lng, geometry.end.lat]).addTo(map));
    }
  }, [geometry, lineFeatures, recordedFeatures, deadhead, status, isVisible, lineColor, pickupLabel, deliveryLabel, routeStops, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isVisible || status !== 'ready' || !map) return;
    if (!live) {
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      liveMarkerStyleRef.current = null;
      return;
    }
    const markerStyle = JSON.stringify([liveMarkerText, liveLabel, liveMarkerIcon]);
    if (!liveMarkerRef.current || liveMarkerStyleRef.current !== markerStyle) {
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = new mapboxgl.Marker({ element: markerElement('#1d4ed8', liveMarkerText, liveLabel, liveMarkerIcon, true) })
        .setLngLat([live.lng, live.lat])
        .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(liveLabel)).addTo(map);
      liveMarkerStyleRef.current = markerStyle;
    } else {
      liveMarkerRef.current.setLngLat([live.lng, live.lat]);
    }
  }, [live, status, isVisible, liveMarkerText, liveMarkerIcon, liveLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isVisible || status !== 'ready' || !map || waitingForStops) return;
    const path = geometry.path.length ? geometry.path : recordedFeatures.flatMap(feature =>
      feature.geometry.coordinates.map(([lng, lat]) => ({ lng, lat })));
    const focusPoints = mapboxFocusPoints({ path, deadheadPath: deadhead.path, stops, live, fitToStops });
    const hasRoute = focusPoints.length > 0;
    const cameraKey = `${routeKey}:${paddingKey}:${focusRequest}:${fitToStops}:${!fitToStops && Boolean(live)}:${JSON.stringify(stops.map(stop => [stop.lat, stop.lng]))}`;
    if (shouldFitMapbox(fittedRouteRef.current, cameraKey, hasRoute)) {
      // The page stays mounted while hidden. Resize before fitting on re-entry.
      if (!containerRef.current?.clientWidth || !containerRef.current?.clientHeight) return;
      map.resize();
      fittedRouteRef.current = { routeKey: cameraKey, hasRoute };
      const padding = JSON.parse(paddingKey);
      if (focusPoints.length === 1) {
        map.jumpTo({
          center: [focusPoints[0].lng, focusPoints[0].lat],
          zoom: 14,
          padding, retainPadding: false,
        });
      } else if (focusPoints.length > 1) {
        const first = focusPoints[0];
        const bounds = focusPoints.reduce(
          (current, point) => current.extend([point.lng, point.lat]),
          new mapboxgl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
        );
        map.fitBounds(bounds, { padding, retainPadding: false, maxZoom: 14, duration: 0 });
      } else {
        map.jumpTo({ center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat], zoom: 5 });
      }
    }
  }, [geometry, recordedFeatures, deadhead, live, routeKey, status, isVisible, paddingKey, focusRequest, stops, fitToStops, waitingForStops]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} role="img" aria-label={title} className="h-full w-full" />
      {(status === 'loading' || (status === 'ready' && waitingForStops)) && (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-900">
          Mapbox…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100 px-6 text-center text-sm font-semibold text-red-600 dark:bg-zinc-900 dark:text-red-400">
          <div role="alert"><p>{t('map.displayError')}</p><button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setRetry(value => value + 1)}>{t('map.retry')}</button></div>
        </div>
      )}
      {status === 'ready' && resourceError && <div role="status" className="absolute left-3 top-3 z-10 max-w-xs rounded-lg bg-white px-3 py-2 text-xs text-amber-800 shadow dark:bg-zinc-900 dark:text-amber-200">
        {t('map.resourceError')} <button type="button" className="font-bold underline" onClick={() => setRetry(value => value + 1)}>{t('map.retry')}</button>
      </div>}
    </div>
  );
}
