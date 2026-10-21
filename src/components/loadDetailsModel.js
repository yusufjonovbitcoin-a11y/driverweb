import { loadMapStops } from './fleetMapModel.js';

function stopDetails(stop = {}) {
  const printedSchedule = [stop.scheduledDate, stop.timePrinted].filter(Boolean).join(' · ');
  const normalizedAppointment = stop.appointmentAt || stop.appointmentFrom || stop.appointment_from;
  return {
    stopId: stop.stopId || stop.id || null,
    city: stop.city || null,
    state: stop.state || stop.region || null,
    postalCode: stop.postalCode || null,
    facility: stop.facility || null,
    address: stop.address || [stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ') || null,
    appointment: normalizedAppointment || printedSchedule || stop.appointmentPrinted || stop.date || null,
    scheduleDate: !normalizedAppointment && printedSchedule ? stop.scheduledDate || null : null,
    scheduleTime: !normalizedAppointment && printedSchedule ? stop.timePrinted || null : null,
    timezone: stop.timezone || stop.appointmentTimezone || stop.appointment_timezone || null,
    contactName: stop.contactName || null,
    contactPhone: stop.contactPhone || null,
    reference: stop.referenceNumber || stop.reference || null,
    appointmentReference: stop.appointmentReference || null,
    orderReferences: stop.orderReferences || null,
    note: stop.note || stop.instructions || null,
  };
}

function uniqueWarnings(warnings) {
  const seen = new Set();
  return warnings.filter((warning) => {
    const key = JSON.stringify([
      warning?.code || '',
      warning?.message || '',
      warning?.field || '',
      warning?.params || null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildLoadDetails(load, driver) {
  const printed = load.driverBrief?.stops || load.stops;
  const source = Array.isArray(printed) && printed.length >= 2 ? printed : [load.origin, load.destination];
  const stops = loadMapStops(load).map((stop, index) => ({
    ...stopDetails({ ...stop, ...source[index] }),
    role: stop.role,
    markerLabel: stop.markerLabel,
  }));
  const documents = [
    { id: 'rateCon', url: load.documents?.rateCon || null },
    { id: 'shipperBol', url: load.documents?.shipperBol || null },
    { id: 'receiverPod', url: load.documents?.receiverPod || null },
    { id: 'receipt', url: load.documents?.receipt || null },
  ].map(document => ({ ...document, available: Boolean(document.url || load.documentMeta?.[document.id]?.current_version_id) }));

  return {
    number: load.loadNumber,
    status: load.databaseStatus || load.status,
    driverName: driver?.name || null,
    broker: load.broker || null,
    brokerContact: load.brokerContact || null,
    brokerPhone: load.brokerPhone || null,
    brokerEmail: load.brokerEmail || null,
    rate: load.rate,
    distanceMiles: load.distanceMiles,
    ratePerMile: load.ratePerMile,
    equipment: load.equipment || null,
    commodity: load.commodity || null,
    weightLbs: load.weightLbs,
    temperature: load.temperature,
    pallets: load.pallets,
    cases: load.cases,
    isHazmat: load.isHazmat,
    specialInstructions: load.specialInstructions || null,
    requirements: Array.isArray(load.requirements) ? load.requirements : [],
    warnings: uniqueWarnings(Array.isArray(load.warnings) ? load.warnings : []),
    pickup: stopDetails(load.origin),
    delivery: stopDetails(load.destination),
    stops,
    documents,
    documentCount: documents.filter((document) => document.available).length,
  };
}

// Latest observed position is display-only: never substitute a START/pay origin.
export function loadCurrentLocation(load, driver, now = Date.now()) {
  if (!driver || load?.driverId !== driver.id) return null;
  const lat = driver.lastKnownPosition?.latitude;
  const lng = driver.lastKnownPosition?.longitude;
  const observedAt = Date.parse(driver.lastKnownPosition?.capturedAt || '');
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === ''
    || (typeof lat === 'string' && !lat.trim()) || (typeof lng === 'string' && !lng.trim())
    || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))
    || Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180
    || !Number.isFinite(observedAt) || observedAt > now + 60_000) return null;
  const accuracy = driver.locationAccuracyMeters;
  return {
    lat: Number(lat), lng: Number(lng), observedAt,
    stale: !driver.isOnline || now - observedAt > 120_000,
    accuracyMeters: accuracy !== null && accuracy !== undefined && accuracy !== ''
      && Number.isFinite(Number(accuracy)) && Number(accuracy) >= 0 ? Number(accuracy) : null,
  };
}

export function latestPickupRouteStops(load, location) {
  if (!location) return [];
  const pickup = loadMapStops(load).find(stop => stop.role === 'pickup');
  if (!pickup) return [];
  return [
    { sequence: 1, role: 'origin', latitude: location.lat, longitude: location.lng },
    { ...pickup, sequence: 2 },
  ];
}


export function pickupEstimateScope(loadId, driverId, stops) {
  return JSON.stringify([loadId, driverId, stops.slice(1)]);
}

export function selectPickupEstimate(scope, current, completed, hasLocation) {
  if (!hasLocation) return null;
  if (current?.scope === scope && current.route) return current;
  return completed?.scope === scope ? completed : null;
}


// Summary and map share the same road results. Never use document miles or
// straight-line distances as a substitute for a failed road calculation.
export function savedLoadRoadSummary(rate, loadedRoute, pickupRoute, hasLocation) {
  const miles = result => !result?.error && !result?.data?.routingFailed
    && Number.isFinite(result?.data?.distanceMeters) && result.data.distanceMeters >= 0
    ? result.data.distanceMeters / 1609.344 : null;
  const loadedMiles = miles(loadedRoute);
  const deadheadMiles = hasLocation ? miles(pickupRoute) : null;
  const totalMiles = loadedMiles != null && deadheadMiles != null ? loadedMiles + deadheadMiles : null;
  return {
    loadedMiles, deadheadMiles, totalMiles,
    ratePerMile: Number.isFinite(rate) && rate >= 0 && totalMiles > 0 ? rate / totalMiles : null,
  };
}


export function savedStopContact(stops, index, contacts = []) {
  const stop = stops[index];
  if (!stop || !Array.isArray(contacts)) return null;
  const routeContacts = contacts.filter(contact => ['pickup', 'delivery'].includes(contact.role));
  const foundPhone = contact => contact?.status === 'found' && typeof contact.phone === 'string' ? contact : null;
  if (stop.stopId) return foundPhone(routeContacts.find(contact => contact.stopId === stop.stopId && contact.role === stop.role));
  const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // An immutable PDF brief may predate edited/reordered DB stops. Without IDs,
  // require the entire ordered route to match before attaching any phone.
  if (routeContacts.length !== stops.length || !stops.every((item, offset) => {
    const contact = routeContacts.find(candidate => candidate.sequence === offset + 1);
    return contact && item.role === contact.role && normalize(item.address)
      && ['address', 'city', 'state', 'postalCode'].every(key => normalize(item[key]) === normalize(contact[key]));
  })) return null;
  return foundPhone(routeContacts.find(contact => contact.sequence === index + 1));
}


export function savedStopContactPhone(stops, index, contacts = []) {
  return savedStopContact(stops, index, contacts)?.phone || null;
}
