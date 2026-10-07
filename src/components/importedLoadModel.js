// The reviewed extraction is authoritative. Never fill a missing verified field
// from an older row, a sample value or a guessed date/timezone.
import { validMapCoordinate } from './mapboxMapModel.js';
import { validPhone } from '../../supabase/functions/_shared/load-enrichment.ts';
import { streetAddressWithoutAppointmentCode } from '../../supabase/functions/_shared/load-stop-address.ts';
import { OPERATIONAL_EXTRACTION_SCOPE } from '../../supabase/functions/_shared/load-operational-extraction.ts';

export function importedMapState(details, driver) {
  const addressBlocked = details.blockingFields.some(key => /^(pickup|delivery|stops\.\d+)\.(addressLine|city|region|postalCode)$/.test(key));
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
    facility: get(`${key}.facilityName`, fallback.facility ?? fallback.facilityName),
    address: get(`${key}.addressLine`, fallback.address ?? fallback.addressLine),
    city: get(`${key}.city`, fallback.city),
    state: get(`${key}.region`, fallback.state ?? fallback.region),
    postalCode: get(`${key}.postalCode`, fallback.postalCode),
    appointment: get(`${key}.appointmentPrinted`, fallback.appointmentPrinted),
    reference: get(`${key}.referenceNumber`, fallback.referenceNumber),
    contact: get(`${key}.contactName`, fallback.contact ?? fallback.contactName),
    phone: validPhone(get(`${key}.contactPhone`, fallback.contactPhone)),
    readyDate: get(`${key}.readyDate`, fallback.readyDate), hours: get(`${key}.hours`, fallback.hours),
    scheduledDate: get(`${key}.scheduledDate`, fallback.scheduledDate), timePrinted: get(`${key}.timePrinted`, fallback.timePrinted), note: get(`${key}.note`, fallback.note),
    timingNote: get(`${key}.timingNote`, fallback.timingNote), timezone: get(`${key}.appointmentTimezone`, fallback.appointmentTimezone),
    appointmentReference: get(`${key}.appointmentReference`, fallback.appointmentReference), orderReferences: get(`${key}.orderReferences`, fallback.orderReferences),
  });
  const firstStop = stop('pickup', load.origin);
  const lastStop = stop('delivery', load.destination);
  const rawStops = Array.isArray(snapshot?.stops) ? snapshot.stops : Array.isArray(load.stops) ? load.stops : [];
  const hasStopEvidence = [...fields.keys()].some(key => /^stops\.\d+\./.test(key));
  const stops = rawStops.length >= 2 && (!hasBrief || snapshot?.version >= 3 || hasStopEvidence)
    ? rawStops.map((item, index) => ({
    ...stop(`stops.${index}`, item), role: item.role, sequence: index + 1,
  })) : [{ ...firstStop, role: 'pickup', sequence: 1 }, { ...lastStop, role: 'delivery', sequence: 2 }];
  const rate = load.rateKnown === false || unknown.has('brokerRate') ? null : load.documentDetails ? get('brokerRate') : load.rate ?? null;
  const distance = load.distanceKnown === false || unknown.has('loadedMiles') ? null : load.documentDetails ? get('loadedMiles') : load.distanceMiles ?? null;
  return {
    operationalOnly: snapshot?.extractionScope === OPERATIONAL_EXTRACTION_SCOPE,
    aiDirect: load.review?.method === 'ai_pdf_direct',
    issues: load.review?.issues || [],
    number: get('loadNumber', load.loadNumber),
    pickup: stops[0], delivery: stops.at(-1), stops,
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
  return [streetAddressWithoutAppointmentCode(stop.address, stop.appointmentReference),
    stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ');
}

// Comparison only: keep the displayed/source strings untouched, with no guessed
// century, timezone or missing date. Recognize explicit US/ISO/named dates.
function scheduleTextKey(value) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const dateKey = (original, year, month, day) => {
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return original;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[‐‑–—−]/g, '-')
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (all, year, month, day) => dateKey(all, year, month, day))
    .replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/g, (all, month, day, year) => dateKey(all, year, month, day))
    .replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*|\s+)(\d{4}|\d{2})\b/g,
      (all, month, day, year) => dateKey(all, year, months.indexOf(month.slice(0, 3)) + 1, day))
    .replace(/\b(\d{1,2}):(\d{2})(?:\s*(am|pm)\b)?/g, (all, hour, minute, period) => {
      let h = Number(hour);
      if (Number(minute) > 59 || h > (period ? 12 : 23) || (period && h < 1)) return all;
      if (period) h = h % 12 + (period === 'pm' ? 12 : 0);
      return `${String(h).padStart(2, '0')}:${minute}`;
    })
    .replace(/[,\s@]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
}

export function stopScheduleParts(stop) {
  const date = scheduleTextKey(stop.scheduledDate), time = scheduleTextKey(stop.timePrinted);
  const appointment = scheduleTextKey(stop.appointment);
  const sameSchedule = appointment && [date, time, [date, time].filter(Boolean).join(' ')].includes(appointment);
  const contains = key => key && ` ${appointment} `.includes(` ${key} `);
  const printedDates = appointment.match(/\b(?:\d{4}|\d{2})-\d{2}-\d{2}\b/g) || [];
  const scheduledDates = date.match(/\b(?:\d{4}|\d{2})-\d{2}-\d{2}\b/g) || [];
  // Keep both schedules when their explicit dates conflict, even if the clock
  // time is the same. Richer FCFS/appointment instructions remain visible.
  const conflictingDate = printedDates.length && scheduledDates.length
    && !scheduledDates.every(value => printedDates.includes(value));
  const richerAppointment = appointment && !sameSchedule && !conflictingDate;
  return [
    ['date', richerAppointment && contains(date) ? null : stop.scheduledDate],
    ['time', richerAppointment && contains(time) ? null : stop.timePrinted],
    ['ready', stop.readyDate],
    ['appointment', sameSchedule ? null : stop.appointment],
    ['hours', stop.hours],
  ].filter(([, value]) => value != null && String(value).trim() !== '');
}

export function importedRatePerMile(details, road) {
  if (!Number.isFinite(details?.rate) || details.rate < 0) return { value: null, source: 'document' };
  if (details.distance != null) return {
    value: details.distance > 0 ? details.rate / details.distance : null,
    source: 'document',
  };
  return {
    value: Number.isFinite(road?.loadedMiles) && road.loadedMiles > 0
      ? details.rate / road.loadedMiles : null,
    source: 'route',
  };
}

export function importedTripRatePerMile(details, road, target) {
  if (!Number.isFinite(details?.rate) || details.rate < 0) return { value: null, source: 'total' };
  if (Number.isFinite(target?.totalMiles) && target.totalMiles > 0) {
    return { value: details.rate / target.totalMiles, source: 'total' };
  }
  if (Number.isFinite(road?.loadedMiles) && road.loadedMiles > 0) {
    return { value: details.rate / road.loadedMiles, source: 'loaded' };
  }
  return { value: null, source: 'total' };
}

export function canAssignImportedLoad(load, driverId, drivers, busy = false) {
  return Boolean((load?.id || load?.previewTicket) && !busy && !load.importError
    && drivers.some(driver => driver.id === driverId)
    && (!load.lifecycleStatus || ['draft', 'review', 'ready_for_offer', 'offered'].includes(load.lifecycleStatus)));
}
