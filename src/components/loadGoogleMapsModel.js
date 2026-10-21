import { validMapCoordinate } from './mapboxMapModel.js';
import { fleetStopAddress } from '../services/fleetRoute.js';
import { googleMapsRouteUrl } from '../services/importRoute.js';

// Mobile browser links support three intermediate stops. Keep the shared
// endpoint between parts, and never silently discard an unknown stop.
export function loadGoogleMapsRoutes(stops = []) {
  if (!Array.isArray(stops) || stops.length < 2) return [];
  const locations = stops.map(stop => validMapCoordinate(stop?.latitude, stop?.longitude)
    ? `${Number(stop.latitude)},${Number(stop.longitude)}` : fleetStopAddress(stop));
  if (locations.some(value => !value)) return [];
  const parts = [];
  for (let start = 0; start < stops.length - 1;) {
    let end = Math.min(start + 4, stops.length - 1);
    let url = googleMapsRouteUrl(locations.slice(start, end + 1));
    while (!url && end > start + 1) {
      end -= 1;
      url = googleMapsRouteUrl(locations.slice(start, end + 1));
    }
    if (!url) return [];
    parts.push({ url, from: stops[start].markerLabel || String(start + 1), to: stops[end].markerLabel || String(end + 1) });
    start = end;
  }
  return parts;
}
