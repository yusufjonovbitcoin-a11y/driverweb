import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  buildMapboxGeometry,
  DEFAULT_MAP_CENTER,
  shouldFitMapbox,
  validMapCoordinate,
} from './mapboxMapModel';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const MAPBOX_STYLE = import.meta.env.VITE_MAPBOX_STYLE_URL?.trim()
  || 'mapbox://styles/mapbox/streets-v12';

function markerElement(color, label, title = label, icon = null) {
  const element = document.createElement('span');
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
    element.style.cssText = `display:grid;place-items:center;width:25px;height:25px;border:3px solid white;border-radius:50%;background:${color};color:white;font:700 11px/1 system-ui;box-shadow:0 2px 9px #0006`;
  }
  return element;
}

function clearMarkers(markers) {
  markers.forEach((item) => item.remove());
  markers.length = 0;
}

export default function TrackingMap({ points, deadheadPoints, livePosition, routeKey, title, routeStops,
  lineColor = '#2563eb', liveMarkerText = 'D', liveMarkerIcon = null,
  pickupLabel = 'A', deliveryLabel = 'B', liveLabel = 'D', isVisible = true }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const liveMarkerRef = useRef(null);
  const liveMarkerStyleRef = useRef(null);
  const fittedRouteRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const liveLatitude = livePosition?.lat;
  const liveLongitude = livePosition?.lng;
  const geometry = useMemo(() => buildMapboxGeometry(points), [points]);
  const deadhead = useMemo(() => buildMapboxGeometry(deadheadPoints || []), [deadheadPoints]);
  const live = useMemo(() => validMapCoordinate(liveLatitude, liveLongitude)
    ? { lat: Number(liveLatitude), lng: Number(liveLongitude) }
    : null, [liveLatitude, liveLongitude]);

  useEffect(() => {
    const markers = markersRef.current;
    if (!MAPBOX_TOKEN || !containerRef.current) {
      setStatus('error');
      return undefined;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    fittedRouteRef.current = null;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      projection: 'mercator',
      center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat],
      zoom: 5,
      attributionControl: true,
    });
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
      setStatus('ready');
    });
    map.on('error', () => setStatus('error'));
    mapRef.current = map;

    return () => {
      clearMarkers(markers);
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      liveMarkerStyleRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!isVisible) {
      map.stop();
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
      features: geometry.lineCoordinates.length < 2 ? [] : [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: geometry.lineCoordinates },
        properties: {},
      }],
    });
    clearMarkers(markersRef.current);

    if (routeStops?.length > 2) {
      routeStops.forEach(stop => {
        if (!validMapCoordinate(stop.latitude, stop.longitude)) return;
        const title = `${stop.sequence} · ${stop.role === 'pickup' ? pickupLabel : deliveryLabel}`;
        markersRef.current.push(new mapboxgl.Marker({ element: markerElement(stop.role === 'pickup' ? '#008573' : '#ef4444', String(stop.sequence), title) })
          .setLngLat([stop.longitude, stop.latitude]).addTo(map));
      });
    } else if (geometry.start) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#008573', 'A', pickupLabel) })
        .setLngLat([geometry.start.lng, geometry.start.lat]).addTo(map));
    }
    if (!(routeStops?.length > 2) && geometry.end && geometry.path.length > 1) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#ef4444', 'B', deliveryLabel) })
        .setLngLat([geometry.end.lng, geometry.end.lat]).addTo(map));
    }
  }, [geometry, deadhead, status, isVisible, lineColor, pickupLabel, deliveryLabel, routeStops]);

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
      liveMarkerRef.current = new mapboxgl.Marker({ element: markerElement('#1d4ed8', liveMarkerText, liveLabel, liveMarkerIcon) })
        .setLngLat([live.lng, live.lat]).addTo(map);
      liveMarkerStyleRef.current = markerStyle;
    } else {
      liveMarkerRef.current.setLngLat([live.lng, live.lat]);
    }
  }, [live, status, isVisible, liveMarkerText, liveMarkerIcon, liveLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isVisible || status !== 'ready' || !map) return;
    const hasRoute = geometry.path.length > 0;
    if (shouldFitMapbox(fittedRouteRef.current, routeKey, hasRoute)) {
      fittedRouteRef.current = { routeKey, hasRoute };
      const focusPoints = [...geometry.path, ...deadhead.path, ...(live ? [live] : [])];
      if (focusPoints.length === 1) {
        map.jumpTo({
          center: [focusPoints[0].lng, focusPoints[0].lat],
          zoom: 14,
        });
      } else if (focusPoints.length > 1) {
        const first = focusPoints[0];
        const bounds = focusPoints.reduce(
          (current, point) => current.extend([point.lng, point.lat]),
          new mapboxgl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
        );
        map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 0 });
      } else {
        map.jumpTo({ center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat], zoom: 5 });
      }
    }
  }, [geometry, deadhead, live, routeKey, status, isVisible]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} role="img" aria-label={title} className="h-full w-full" />
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-900">
          Mapbox…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100 px-6 text-center text-sm font-semibold text-red-600 dark:bg-zinc-900 dark:text-red-400">
          Mapbox token sozlanmagan yoki ishlamayapti
        </div>
      )}
    </div>
  );
}
