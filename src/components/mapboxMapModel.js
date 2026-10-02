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
