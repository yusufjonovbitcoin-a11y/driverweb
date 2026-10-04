import { evidenceFromSource, storedPdfSource, type PdfSource } from './pdf-source.ts';
// Every value travels with its source. Nullable values must not be guessed.
const sourced = (schema: any) => ({
  type: 'object', additionalProperties: false,
  properties: { value: schema, page: { type: ['integer', 'null'] }, quote: { type: ['string', 'null'] } },
  required: ['value', 'page', 'quote'],
});
const clause = { type: 'object', additionalProperties: false,
  properties: { value: { type: 'string' }, page: { type: 'integer' } }, required: ['value', 'page'] };

export function sourcedExtractionSchema(legacy: any, stop: any, grounded = false) {
  const bound = (schema: any) => grounded ? { type: 'object', additionalProperties: false,
    properties: { value: schema, source_ids: { type: 'array', maxItems: 80, items: { type: 'string' } } },
    required: ['value', 'source_ids'] } : sourced(schema);
  const wrapObject = (properties: any) => ({ type: 'object', additionalProperties: false,
    properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, bound(value)])),
    required: Object.keys(properties) });
  const omitted = new Set(['pickup', 'delivery', 'evidence', 'pickupCount', 'deliveryCount', 'confidence', 'missingFields']);
  const properties = Object.fromEntries(Object.entries(legacy.properties).filter(([key]) => !omitted.has(key)).map(([key, schema]: [string, any]) =>
    [key, key === 'documentReview' ? schema : key === 'broker' ? wrapObject(schema.properties)
      : ['requirements', 'contractTerms'].includes(key) ? { ...schema, items: grounded ? bound({ type: 'string' }) : clause } : bound(schema)]));
  properties.stops = { type: 'array', minItems: 2, maxItems: 25, items: {
    ...wrapObject(stop.properties),
    properties: { role: { type: 'string', enum: ['pickup', 'delivery'] }, ...wrapObject(stop.properties).properties },
    required: ['role', ...Object.keys(stop.properties)],
  } };
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}

export function decodeSourcedExtraction(wire: any, source?: PdfSource) {
  // JSON.parse accepts NUL/lone surrogates, PostgreSQL jsonb does not. Preserve
  // a visible replacement instead of removing characters and accidentally
  // turning a corrupted identifier into a seemingly valid one. Rules still
  // compare the resulting field against the untouched trusted PDF text.
  wire = databaseSafeModelText(wire);
  if (source && (!Array.isArray(wire?.stops) || wire.documentReview?.pageCount !== source.pageCount)) throw Error('PDF_SOURCE_PAGE_MISMATCH');
  // Legacy snapshots are still understood; only new requests use the bound schema.
  if (!Array.isArray(wire?.stops)) return wire;
  const evidence: any[] = [];
  const field = (entry: any, path: string) => {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'value')) throw Error(`Invalid source field: ${path}`);
    if (entry.value != null && entry.value !== '') {
      const trusted = source ? evidenceFromSource(entry.source_ids, source, path) : null;
      if (source) { if (trusted) evidence.push(trusted); }
      else evidence.push({ field: path, page: entry.page,
        quote: /^(requirements|contractTerms)\./.test(path) ? entry.value : entry.quote });
    }
    return entry.value;
  };
  const result: any = { evidence };
  for (const [key, value] of Object.entries(wire)) {
    if (key === 'documentReview') result[key] = value;
    else if (key === 'broker') result[key] = Object.fromEntries(Object.entries(value as any).map(([name, item]) => [name, field(item, `broker.${name}`)]));
    else if (key === 'stops') result.stops = (value as any[]).map((stop, i) => Object.fromEntries(Object.entries(stop).map(([name, item]) =>
      [name, name === 'role' ? item : field(item, `stops.${i}.${name}`)])));
    else if (Array.isArray(value)) result[key] = value.map((item, i) => field(item, `${key}.${i}`));
    else result[key] = field(value, key);
  }
  result.pickupCount = result.stops.filter((s: any) => s.role === 'pickup').length;
  result.deliveryCount = result.stops.filter((s: any) => s.role === 'delivery').length;
  if (source) result.sourceManifest = storedPdfSource(source);
  return result;
}

export function databaseSafeModelText(value: any): any {
  if (typeof value === 'string') return value.toWellFormed().replaceAll('\u0000', '\uFFFD');
  if (Array.isArray(value)) return value.map(databaseSafeModelText);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [databaseSafeModelText(key), databaseSafeModelText(item)]));
  return value;
}
