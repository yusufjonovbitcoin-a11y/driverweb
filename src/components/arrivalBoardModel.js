import { loadCurrentLocation } from './loadDetailsModel.js';
import { loadMapStops, stopCity } from './fleetMapModel.js';
import { normalizeSearchText } from '../utils/globalSearch.js';

const ACTIVE = new Set(['ASSIGNED', 'PICKED_UP', 'ON_ROAD']);
export function arrivalJobs(drivers, loads, now = Date.now()) {
  return drivers.flatMap(driver => {
    const active = loads.filter(load => load.driverId === driver.id && ACTIVE.has(load.status)
      && !load.trashedAt && !['cancelled', 'dispute', 'completed', 'delivered'].includes(load.databaseStatus));
    if (!active.length) return [{ id: `idle:${driver.id}`, driver, load: null }];
    return active.map(load => {
      const role = load.status === 'ASSIGNED' ? 'pickup' : 'delivery';
      const stops = loadMapStops(load);
      // Per-stop completion is not part of the workspace snapshot. Never skip
      // intermediate stops or guess the active assignment for stacked loads.
      const ambiguous = active.length > 1 || stops.length > 2;
      const target = !ambiguous ? stops.find(stop => stop.role === role) : null;
      const endpoint = role === 'pickup' ? load.origin : load.destination;
      const value = endpoint?.appointmentTo || endpoint?.appointmentAt;
      // Only offset-qualified instants are safe to compare across time zones.
      const scheduledAt = !ambiguous && typeof value === 'string' && /T.*(Z|[+-]\d{2}:\d{2})$/i.test(value)
        && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
      const location = loadCurrentLocation(load, driver, now);
      const scope = JSON.stringify([load.id, driver.id, role, target, ambiguous]);
      return { id: load.id, driver, load, role, target, scheduledAt, location, scope, ambiguous,
        origin: stopCity(load.origin), destination: stopCity(load.destination) };
    });
  });
}

export function arrivalState(job, estimate, now = Date.now()) {
  if (!job.load) return { status: 'idle', eta: null, issue: 'idle' };
  const valid = estimate?.scope === job.scope && Number.isFinite(estimate?.eta)
    && estimate.observedAt <= now + 60_000 && now - estimate.observedAt <= 120_000
    && estimate.eta >= now && job.location && !job.location.stale;
  const eta = valid ? estimate.eta : null;
  if (job.ambiguous) return { status: 'unknown', eta: null, issue: 'multipleStops' };
  if (!job.location || job.location.stale) return { status: 'noGps', eta: null, issue: 'noGps' };
  if (eta === null) return { status: 'unknown', eta: null, issue: 'noEstimate' };
  if (job.scheduledAt === null) return { status: 'unknown', eta, issue: 'noAppointment' };
  const margin = job.scheduledAt - eta;
  if (margin < 0) return { status: 'late', eta, issue: 'late', minutes: Math.ceil(-margin / 60_000) };
  if (margin < 30 * 60_000) return { status: 'risk', eta, issue: 'tightWindow' };
  return { status: 'onTime', eta, issue: 'onTime' };
}

export function arrivalLane(eta, now) {
  if (!Number.isFinite(eta)) return 'unknown';
  const hours = (eta - now) / 3_600_000;
  return hours <= 2 ? 'soon' : hours <= 4 ? 'next' : 'later';
}

export function arrivalMatches(job, query) {
  const text = normalizeSearchText([job.driver.name, job.driver.driverNumber, job.driver.phone,
    job.load?.loadNumber, job.origin, job.destination, job.load?.broker].filter(Boolean).join(' '));
  return normalizeSearchText(query).split(' ').filter(Boolean).every(token => text.includes(token));
}

export function arrivalPhone(value) {
  const number = String(value || '').replace(/[^\d+]/g, '');
  return /^\+?\d{5,15}$/.test(number) ? `tel:${number}` : null;
}
