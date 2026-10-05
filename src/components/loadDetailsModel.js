import { loadMapStops } from './fleetMapModel.js';

function stopDetails(stop = {}) {
  return {
    facility: stop.facility || null,
    address: stop.address || [stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ') || null,
    appointment: stop.appointmentAt || stop.date || null,
    timezone: stop.timezone || null,
    contactName: stop.contactName || null,
    contactPhone: stop.contactPhone || null,
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
