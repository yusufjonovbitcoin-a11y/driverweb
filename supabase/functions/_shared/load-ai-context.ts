const STOP_FACTS: Record<string, string> = {
  scheduledDate: 'documentDate', timePrinted: 'documentTime',
  appointmentPrinted: 'documentWindow', hours: 'documentHours',
  referenceNumber: 'referenceNumber', appointmentReference: 'appointmentReference',
  orderReferences: 'orderReferences', note: 'instructions', timingNote: 'timingNote',
};

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
