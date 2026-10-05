import { normalizeSearchText } from '../utils/globalSearch.js';
import { validMapCoordinate } from './mapboxMapModel.js';

export function tripStops(load) {
  const printed = load?.driverBrief?.stops || load?.stops;
  return [load?.origin, load?.destination, ...(Array.isArray(printed) ? printed : [])].filter(Boolean);
}

export function tripMatchesSearch(load, query) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const values = [load?.loadNumber, ...tripStops(load).flatMap(stop => [
    stop.address, stop.addressLine, stop.street, stop.city, stop.state, stop.region,
    stop.postalCode, stop.zip, stop.facility, stop.facilityName,
  ])].map(normalizeSearchText).filter(Boolean);
  const text = [...values, ...values.map(value => value.replaceAll(' ', ''))].join(' ');
  return tokens.every(token => text.includes(token));
}

function timestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tripTimestamp(load, sessions = []) {
  const starts = sessions.filter(session => session.load_id === load.id)
    .map(session => timestamp(session.started_at)).filter(value => value !== null);
  // The actual tracking session is preferable to updated_at (which may change
  // when documents or payment details are edited long after a trip).
  if (starts.length) return Math.max(...starts);
  for (const value of [load.origin?.appointmentAt, load.origin?.date, load.dispatchedAt]) {
    const parsed = timestamp(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function driverTrips(loads, driverId, sessions = []) {
  if (!driverId) return [];
  const historicIds = new Set(sessions.map(session => session.load_id));
  return loads.filter(load => load.driverId === driverId || historicIds.has(load.id))
    .map(load => ({ load, date: tripTimestamp(load, sessions) }))
    .sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity)
      || String(a.load.id).localeCompare(String(b.load.id)))
    .map(item => item.load);
}

export function selectedDriverTrip(trips, currentLoad, selectedId) {
  // An old selection must never leak another driver's route into this view.
  return trips.find(load => load.id === selectedId) || currentLoad || trips[0] || null;
}

export function filteredTrips(trips, { query = '', period = 'all', sessions = [], now = Date.now() } = {}) {
  const days = period === '7' ? 7 : period === '30' ? 30 : null;
  return trips.filter(load => {
    if (!tripMatchesSearch(load, query)) return false;
    if (days === null) return true;
    const date = tripTimestamp(load, sessions);
    return date !== null && date >= now - days * 86_400_000 && date <= now;
  });
}

export function stopCity(stop) {
  return [stop?.city, stop?.state || stop?.region].filter(Boolean).join(', ')
    || stop?.facility || stop?.facilityName || stop?.address || stop?.addressLine || '—';
}

export function stopStreet(stop) {
  const street = stop?.address || stop?.addressLine || stop?.street;
  // The normalized load may use city/state as its address fallback; don't
  // repeat it as a fabricated street in the route dock.
  return street && normalizeSearchText(street) !== normalizeSearchText(stopCity(stop))
    ? street : stop?.facility || stop?.facilityName || '';
}

export function loadMapStops(load) {
  if (!load) return [];
  const printed = load.driverBrief?.stops || load.stops;
  const source = Array.isArray(printed) && printed.length >= 2 ? printed : [load.origin, load.destination];
  const counts = { pickup: 0, delivery: 0 };
  return source.map((stop, index) => {
    const endpoint = index === 0 ? load.origin : index === source.length - 1 ? load.destination : null;
    const role = stop?.role === 'pickup' || stop?.role === 'delivery' ? stop.role : index === 0 ? 'pickup' : 'delivery';
    const number = ++counts[role];
    return {
      sequence: index + 1,
      role,
      markerLabel: `${role === 'pickup' ? 'P' : 'D'}${number}`,
      facility: stop?.facility ?? stop?.facilityName ?? endpoint?.facility ?? null,
      address: stop?.address ?? stop?.addressLine ?? stop?.street ?? endpoint?.address ?? null,
      city: stop?.city ?? endpoint?.city ?? null,
      state: stop?.state ?? stop?.region ?? endpoint?.state ?? null,
      postalCode: stop?.postalCode ?? stop?.zip ?? endpoint?.postalCode ?? null,
      latitude: stop?.latitude ?? stop?.lat ?? endpoint?.lat,
      longitude: stop?.longitude ?? stop?.lng ?? endpoint?.lng,
    };
  });
}

export function isActiveFleetLoad(load, driver) {
  return Boolean(load && driver && load.driverId === driver.id
    && ['ASSIGNED', 'PICKED_UP', 'ON_ROAD'].includes(load.status)
    && !['completed', 'delivered', 'cancelled', 'dispute'].includes(load.databaseStatus));
}

export function fleetLivePosition(load, driver, points = []) {
  if (!isActiveFleetLoad(load, driver)) return null;
  if (driver.isOnline && validMapCoordinate(driver.lat, driver.lng)) {
    return { lat: Number(driver.lat), lng: Number(driver.lng), source: 'live' };
  }
  const last = points.findLast(point => validMapCoordinate(point?.latitude, point?.longitude));
  return last ? { lat: Number(last.latitude), lng: Number(last.longitude), source: 'recorded' } : null;
}

export function overlayMapPadding({ width, height, leftPanelWidth = 0, bottomPanelHeight = 0 }) {
  // Leave a usable viewport even when a tablet has both overlays open.
  const left = leftPanelWidth ? leftPanelWidth + 52 : 36;
  const bottom = bottomPanelHeight ? bottomPanelHeight + 52 : 44;
  return {
    top: Math.round(Math.min(72, height * 0.16)),
    right: Math.round(Math.min(52, width * 0.12)),
    left: Math.round(Math.min(left, width * 0.48)),
    bottom: Math.round(Math.min(bottom, height * 0.4)),
  };
}
