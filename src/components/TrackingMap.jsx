import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  buildMapboxGeometry,
  DEFAULT_MAP_CENTER,
  shouldFitMapbox,
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

export default function TrackingMap({ points, deadheadPoints, livePosition, routeKey, title,
  lineColor = '#2563eb', liveMarkerText = 'D', liveMarkerIcon = null,
  pickupLabel = 'A', deliveryLabel = 'B', liveLabel = 'D' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fittedRouteRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const liveLatitude = livePosition?.lat;
  const liveLongitude = livePosition?.lng;

  useEffect(() => {
    const markers = markersRef.current;
    if (!MAPBOX_TOKEN || !containerRef.current) {
      setStatus('error');
      return undefined;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
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
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;

    const geometry = buildMapboxGeometry(points, { lat: liveLatitude, lng: liveLongitude });
    const deadhead = buildMapboxGeometry(deadheadPoints || []);
    map.getSource('driver-deadhead')?.setData({ type: 'FeatureCollection', features: deadhead.lineCoordinates.length < 2 ? [] : [{
      type: 'Feature', geometry: { type: 'LineString', coordinates: deadhead.lineCoordinates }, properties: {},
    }] });
    geometry.focusPoints.push(...deadhead.path);
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

    if (geometry.start) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#008573', 'A', pickupLabel) })
        .setLngLat([geometry.start.lng, geometry.start.lat]).addTo(map));
    }
    if (geometry.end && geometry.path.length > 1) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#ef4444', 'B', deliveryLabel) })
        .setLngLat([geometry.end.lng, geometry.end.lat]).addTo(map));
    }
    if (geometry.live) {
      markersRef.current.push(new mapboxgl.Marker({ element: markerElement('#1d4ed8', liveMarkerText, liveLabel, liveMarkerIcon) })
        .setLngLat([geometry.live.lng, geometry.live.lat]).addTo(map));
    }

    const hasRoute = geometry.path.length > 0;
    if (shouldFitMapbox(fittedRouteRef.current, routeKey, hasRoute)) {
      fittedRouteRef.current = { routeKey, hasRoute };
      if (geometry.focusPoints.length === 1) {
        map.jumpTo({
          center: [geometry.focusPoints[0].lng, geometry.focusPoints[0].lat],
          zoom: 14,
        });
      } else if (geometry.focusPoints.length > 1) {
        const first = geometry.focusPoints[0];
        const bounds = geometry.focusPoints.reduce(
          (current, point) => current.extend([point.lng, point.lat]),
          new mapboxgl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
        );
        map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 0 });
      } else {
        map.jumpTo({ center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat], zoom: 5 });
      }
    }
  }, [points, deadheadPoints, liveLatitude, liveLongitude, routeKey, status, title, lineColor, liveMarkerText, liveMarkerIcon, pickupLabel, deliveryLabel, liveLabel]);

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
