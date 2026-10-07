import { freshPosition } from './load-enrichment.ts';

const STOP_FACTS: Record<string, string> = {
  scheduledDate: 'documentDate', timePrinted: 'documentTime',
  appointmentPrinted: 'documentWindow', hours: 'documentHours',
  referenceNumber: 'referenceNumber', appointmentReference: 'appointmentReference',
  orderReferences: 'orderReferences', note: 'instructions', timingNote: 'timingNote',
};

// A previous answer can contain terms that staff have since hidden. History is
// client-supplied, so the current server projection is the privacy authority.
export function loadAiConversationHistory<T>(
  load: { driver_pay?: unknown; broker_terms_hidden?: boolean }, history: T[],
): T[] {
  return load.driver_pay || load.broker_terms_hidden === true ? [] : history;
}

// Add only reviewed operational values. Never send source quotes or a hidden
// broker brief to the model; hidden-price drivers use the server allowlist.
export function loadAiStops(load: any, stops: any[]) {
  const facts: Record<string, unknown> = {};
  const brief = load.driver_brief;
  if (!load.broker_terms_hidden && !load.driver_pay && brief?.version === 1
    && typeof brief.reviewedAt === 'string' && brief.reviewedAt
    && Array.isArray(brief.blockingFields) && !brief.blockingFields.length
    && Array.isArray(brief.fields)) {
    for (const field of brief.fields) if (typeof field?.key === 'string') facts[field.key] = field.value;
  }
  if (load.driver_stop_details && typeof load.driver_stop_details === 'object') {
    Object.assign(facts, load.driver_stop_details);
  }
  return stops.map(stop => {
    if (!Number.isInteger(stop.sequence) || stop.sequence < 1) return { ...stop };
    const prefix = `stops.${stop.sequence - 1}.`;
    const indexed = Object.keys(facts).some(key => key.startsWith(prefix));
    const extra: Record<string, string> = {};
    for (const [field, label] of Object.entries(STOP_FACTS)) {
      const value = facts[prefix + field] ?? (!indexed && stops.length === 2 ? facts[`${stop.type}.${field}`] : null);
      if (typeof value === 'string' && value.trim()) extra[label] = value.trim();
    }
    return { ...stop, ...extra };
  });
}

// Heartbeat metadata is separate from a GPS capture. A recent heartbeat cannot
// make a cached coordinate into the driver's current position in model context.
export function loadAiPresence(row: any, now = Date.now()) {
  if (!row) return null;
  const position = freshPosition(row, now);
  const heartbeatAge = now - Date.parse(row.last_seen_at);
  return {
    is_online: row.is_online === true && Number.isFinite(heartbeatAge)
      && heartbeatAge >= -30_000 && heartbeatAge < 120_000,
    last_seen_at: row.last_seen_at ?? null,
    ...(position ? {
      ...position,
      location_captured_at: row.location_captured_at,
      heading: row.heading ?? null,
      speed_mph: row.speed_mph ?? null,
    } : {}),
  };
}
