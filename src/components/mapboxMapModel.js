export const DEFAULT_MAP_CENTER = { lat: 39.6542, lng: 66.9597 };

export function validMapCoordinate(latitude, longitude) {
  if (latitude === null || latitude === undefined || latitude === ''
      || longitude === null || longitude === undefined || longitude === '') return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

function coordinate(latitude, longitude) {
  if (!validMapCoordinate(latitude, longitude)) return null;
  return { lat: Number(latitude), lng: Number(longitude) };
}

export function buildMapboxGeometry(points = [], livePosition = null) {
  const path = points
    .map((point) => coordinate(point?.latitude, point?.longitude))
    .filter(Boolean);
  const live = coordinate(livePosition?.lat, livePosition?.lng);

  return {
    path,
    lineCoordinates: path.map((point) => [point.lng, point.lat]),
    start: path[0] || null,
    end: path.at(-1) || null,
    live,
    focusPoints: live ? [...path, live] : path,
  };
}

export function shouldFitMapbox(previous, routeKey, hasRoute) {
  return previous?.routeKey !== routeKey || (!previous?.hasRoute && hasRoute);
}

export function validMapStops(stops = []) {
  return (stops || []).filter(stop => validMapCoordinate(stop?.latitude, stop?.longitude))
    .map(stop => ({ ...stop, lat: Number(stop.latitude), lng: Number(stop.longitude) }));
}

export function mapboxFocusPoints({ path = [], deadheadPath = [], stops = [], live = null, fitToStops = false } = {}) {
  // Fleet view frames every pickup/delivery, not a distant truck or GPS outlier.
  // Keep the whole-track/deadhead framing for the import preview.
  if (fitToStops) return stops.length ? stops : path;
  return [...path, ...deadheadPath, ...stops, ...(live ? [live] : [])];
}

export function mapboxLineFeatures(points = [], recorded = false) {
  if (!recorded) {
    const geometry = buildMapboxGeometry(points);
    return geometry.lineCoordinates.length < 2 ? [] : [{ type: 'Feature',
      geometry: { type: 'LineString', coordinates: geometry.lineCoordinates }, properties: {} }];
  }
  const segments = [];
  let segment = [], assignment;
  const flush = () => { if (segment.length > 1) segments.push(segment); segment = []; };
  for (const point of points) {
    if (!validMapCoordinate(point?.latitude, point?.longitude)) { flush(); assignment = undefined; continue; }
    if (segment.length && point.assignment_id !== assignment) flush();
    assignment = point.assignment_id;
    segment.push([Number(point.longitude), Number(point.latitude)]);
  }
  flush();
  // Preserve GPS as recorded: no road snapping or invented links between
  // different tracking assignments or across invalid samples.
  return segments.map(coordinates => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }));
}
