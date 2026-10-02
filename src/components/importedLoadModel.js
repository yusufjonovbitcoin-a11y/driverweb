// The reviewed extraction is authoritative. Never fill a missing verified field
// from an older row, a sample value or a guessed date/timezone.
import { validMapCoordinate } from './mapboxMapModel.js';
import { validPhone } from '../../supabase/functions/_shared/load-enrichment.ts';

export function importedMapState(details, driver) {
  const addressBlocked = details.blockingFields.some(key => /^(pickup|delivery)\.(addressLine|city|region|postalCode)$/.test(key));
  return {
    routeEnabled: !addressBlocked,
    livePosition: driver?.isOnline && validMapCoordinate(driver.lat, driver.lng)
      ? { lat: Number(driver.lat), lng: Number(driver.lng) } : null,
  };
}

export function buildImportedLoad(load = {}) {
  const snapshot = Array.isArray(load.documentDetails?.fields) ? load.documentDetails : load.driverBrief;
  const hasBrief = Array.isArray(snapshot?.fields);
  const fields = new Map((snapshot?.fields || []).map(field => [field.key, field]));
  const unknown = new Set(snapshot?.unknownFields || []);
  const get = (key, fallback) => hasBrief ? fields.get(key)?.value ?? null : fallback ?? null;
  const stop = (key, fallback = {}) => ({
    facility: get(`${key}.facilityName`, fallback.facility),
    address: get(`${key}.addressLine`, fallback.address),
    city: get(`${key}.city`, fallback.city),
    state: get(`${key}.region`, fallback.state),
    postalCode: get(`${key}.postalCode`, fallback.postalCode),
    appointment: get(`${key}.appointmentPrinted`, fallback.appointmentPrinted),
    reference: get(`${key}.referenceNumber`, fallback.referenceNumber),
    contact: get(`${key}.contactName`, fallback.contactName),
    phone: validPhone(get(`${key}.contactPhone`, fallback.contactPhone)),
    readyDate: get(`${key}.readyDate`), hours: get(`${key}.hours`),
    scheduledDate: get(`${key}.scheduledDate`), timePrinted: get(`${key}.timePrinted`), note: get(`${key}.note`),
    appointmentReference: get(`${key}.appointmentReference`), orderReferences: get(`${key}.orderReferences`),
  });
  const rate = load.rateKnown === false || unknown.has('brokerRate') ? null : load.documentDetails ? get('brokerRate') : load.rate ?? null;
  const distance = load.distanceKnown === false || unknown.has('loadedMiles') ? null : load.documentDetails ? get('loadedMiles') : load.distanceMiles ?? null;
  return {
    number: get('loadNumber', load.loadNumber),
    pickup: stop('pickup', load.origin), delivery: stop('delivery', load.destination),
    broker: get('broker.name', load.broker), brokerContact: get('broker.contactName', load.brokerContact),
    brokerPhone: validPhone(get('broker.phone', load.brokerPhone)), brokerEmail: load.documentDetails ? get('broker.email') : load.brokerEmail || null,
    equipment: get('equipmentType', load.equipment), cargo: get('cargoDescription', load.commodity),
    temperature: get('temperatureFahrenheit', load.temperatureFahrenheit ?? load.temperature),
    weight: get('weightLbs', load.weightLbs), pallets: get('palletCount', load.palletCount ?? load.pallets),
    weightPrinted: get('weightPrinted'),
    cases: get('caseCount', load.caseCount ?? load.cases), hazmat: get('isHazmat', load.isHazmat),
    pieces: get('pieceCount'), packages: get('packageCount'),
    instructions: get('specialInstructions', load.specialInstructions),
    extendedDocument: load.documentDetails?.version >= 2,
    bolNumber: get('bolNumber'), documentDriverName: get('documentDriverName'),
    requirements: hasBrief ? [...fields.values()].filter(field => field.key.startsWith('requirements.')).map(field => field.value)
      : load.requirements || [],
    rate, distance, rpm: rate != null && distance > 0 ? rate / distance : null,
    fields: [...fields.values()], blockingFields: load.review?.blockingFields || [],
  };
}

export function stopAddress(stop) {
  return [stop.address, stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ');
}

export function canAssignImportedLoad(load, driverId, drivers, confirmed, busy = false) {
  return Boolean(load?.id && !busy && !load.importError
    && !load.review?.blockingFields?.length
    && (!load.review?.required || confirmed)
    && drivers.some(driver => driver.id === driverId)
    && (!load.lifecycleStatus || ['draft', 'review', 'ready_for_offer', 'offered'].includes(load.lifecycleStatus)));
}
