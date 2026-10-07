// Model output is untrusted. Only independently supported fields enter the brief.
import { validPhone } from './load-enrichment.ts';
import { EXTRA_DOCUMENT_FIELDS, EXTRA_STOP_FIELDS, STAFF_DOCUMENT_FIELDS } from './load-document-fields.ts';
import { singlePassValueSupported, sourcePrintedDate } from './load-single-pass.ts';
import { evidenceFromSource } from './pdf-source.ts';
import { dispatchBlockingFields, dispatchWarningFields } from './load-dispatch-policy.ts';
import { streetAddressWithoutAppointmentCode } from './load-stop-address.ts';
import { OPERATIONAL_EXTRACTION_SCOPE, isOperationalExtractionField } from './load-operational-extraction.ts';
export const FIELD_TYPES = {
  loadNumber: 'string',
  'broker.name': 'string', 'broker.contactName': 'string', 'broker.phone': 'string',
  'broker.email': 'string', 'broker.fax': 'string',
  freightMode: 'string', cargoDescription: 'string', equipmentType: 'string',
  temperatureFahrenheit: 'number', palletCount: 'integer', caseCount: 'integer', pieceCount: 'integer', packageCount: 'integer',
  isHazmat: 'boolean', specialInstructions: 'string', weightLbs: 'integer', weightPrinted: 'string',
  brokerRate: 'number', loadedMiles: 'number',
  ...Object.fromEntries(EXTRA_DOCUMENT_FIELDS.map(key => [key, 'string'])),
  ...Object.fromEntries(['pickup', 'delivery'].flatMap(stop => [
    'facilityName', 'addressLine', 'city', 'region', 'postalCode',
    'appointmentFrom', 'appointmentTo', 'appointmentTimezone', 'appointmentPrinted',
    'referenceNumber', 'contactName', 'contactPhone', 'readyDate', 'hours', 'appointmentReference', 'orderReferences',
    ...EXTRA_STOP_FIELDS,
  ].map(field => [`${stop}.${field}`, 'string']))),
} as Record<string, string>;

export const EVIDENCE_PATHS = [...Object.keys(FIELD_TYPES), ...['requirements', 'contractTerms'].flatMap(key => Array.from({ length: 128 }, (_, i) => `${key}.${i}`))];

type Evidence = { field: string; page: number; quote: string; sourceIds?: string[] };
type Review = { field: string; verdict: string; page: number | null; quote: string | null };
const get = (data: any, path: string) => path.split('.').reduce((value, key) => value?.[key], data);
const normalizeQuote = (value: string) => value.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
function set(data: any, path: string, value: unknown) {
  const keys = path.split('.');
  let parent = data;
  for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
  parent[keys.at(-1)!] = value;
}

export function verifyLoadExtraction(candidate: any, audit: any, singlePass = false) {
  const operationalOnly = singlePass && candidate?.extractionScope === OPERATIONAL_EXTRACTION_SCOPE;
  const aiPdfDirect = singlePass && candidate?.extractionMode === 'ai_pdf_direct';
  if (singlePass && Array.isArray(candidate?.stops)) candidate = { ...candidate,
    stops: candidate.stops.map((stop: any) => ({ ...stop,
      addressLine: streetAddressWithoutAppointmentCode(stop.addressLine, stop.appointmentReference) })) };
  const stops = singlePass && Array.isArray(candidate?.stops) ? candidate.stops : null;
  if (stops) {
    if (stops.length < 2 || stops.length > 25 || stops[0].role !== 'pickup' || stops.at(-1).role !== 'delivery'
      || stops.some((s: any) => !['pickup', 'delivery'].includes(s.role))
      || candidate.pickupCount !== stops.filter((s: any) => s.role === 'pickup').length
      || candidate.deliveryCount !== stops.filter((s: any) => s.role === 'delivery').length) throw Error('Stop order/count needs review');
    // Compatibility aliases are derived from the ordered route, never separately extracted.
    candidate = { ...candidate, pickup: stops[0], delivery: stops.at(-1), evidence: [...candidate.evidence] };
    for (const [role, index] of [['pickup', 0], ['delivery', stops.length - 1]] as const) {
      candidate.evidence.push(...candidate.evidence.filter((e: any) => e.field.startsWith(`stops.${index}.`))
        .map((e: any) => ({ ...e, field: e.field.replace(`stops.${index}.`, `${role}.`) })));
    }
  }
  if (singlePass) {
    audit = candidate?.documentReview;
    if (!audit || (!aiPdfDirect && audit.allPagesRead !== true) || !Number.isInteger(audit.pageCount) || audit.pageCount < 1
      || !Array.isArray(audit.uncertainFields)) throw new Error('Hujjatning barcha sahifalari aniq o‘qilmadi. Asl faylni tekshiring.');
    if (stops) audit = { ...audit, uncertainFields: [...audit.uncertainFields,
      ...audit.uncertainFields.filter((key: string) => key.startsWith('stops.0.')).map((key: string) => key.replace('stops.0.', 'pickup.')),
      ...audit.uncertainFields.filter((key: string) => key.startsWith(`stops.${stops.length - 1}.`)).map((key: string) => key.replace(`stops.${stops.length - 1}.`, 'delivery.'))] };
  }
  if (!candidate || !audit || audit.documentReadable !== true || audit.singleLoad !== true
      || (!stops && (candidate.pickupCount !== 1 || candidate.deliveryCount !== 1))
      || (!singlePass && (audit.pickupCount !== 1 || audit.deliveryCount !== 1))) {
    throw new Error('Hujjat aniq bitta yuk, bitta pickup va bitta deliveryni ko‘rsatishi kerak. To‘liq va tiniq hujjat yuklang.');
  }
  const canonical = (item: any) => ({ ...item, field: String(item?.field ?? '').replace(/\[(\d+)\]/g, '.$1') });
  // Rebuild even cached/corrected evidence from the stored trusted manifest.
  const evidence: Evidence[] = Array.isArray(candidate.evidence) ? candidate.evidence.map(canonical)
    .map((e: any) => candidate.sourceManifest ? evidenceFromSource(e.sourceIds, candidate.sourceManifest, e.field) : e).filter(Boolean) : [];
  const reviews: Review[] = Array.isArray(audit.fields) ? audit.fields.map(canonical) : [];
  const safe: any = { broker: {}, pickup: {}, delivery: {}, requirements: [], contractTerms: [] };
  const fields: Array<{ key: string; value: unknown; page: number | null; quote: string | null }> = [];
  const rejectedFields: string[] = [];
  const issues: any[] = [];
  const missingFields: string[] = [];
  if (stops) safe.stops = stops.map((stop: any) => ({ role: stop.role }));
  const stopTypes = Object.entries(FIELD_TYPES).filter(([key]) => key.startsWith('pickup.'));
  const paths = { ...FIELD_TYPES, ...Object.fromEntries((stops ?? []).flatMap((_: any, i: number) =>
    stopTypes.map(([key, type]) => [key.replace('pickup.', `stops.${i}.`), type]))), ...Object.fromEntries(
    ['requirements', 'contractTerms'].flatMap(key => (Array.isArray(candidate[key]) ? candidate[key] : []).map((_: unknown, index: number) => [`${key}.${index}`, 'string'])),
  ) };
  for (const [path, type] of Object.entries(paths)) {
    if (operationalOnly && !isOperationalExtractionField(path)) continue;
    const raw = get(candidate, path);
    let value = typeof raw === 'string' ? raw.trim() : raw;
    if (value == null || value === '') {
      set(safe, path, null);
      missingFields.push(path);
      continue;
    }
    const source = evidence.filter(item => item?.field === path);
    if (singlePass && !aiPdfDirect && source.length === 1 && typeof source[0].quote === 'string') value = sourcePrintedDate(path, value, source[0].quote);
    const checked = reviews.filter(item => item?.field === path);
    const correctType = type === 'string' ? typeof value === 'string'
      : type === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'number' && Number.isFinite(value)
        && (type !== 'integer' || Number.isInteger(value))
        && (path === 'temperatureFahrenheit' || value >= 0)
        && (path !== 'weightLbs' || value > 0);
    const validEvidence = (item: any) => Number.isInteger(item?.page) && item.page > 0
      && typeof item.quote === 'string' && item.quote.trim().length > 0 && item.quote.length <= 4000;
    const phoneField = /(?:\.phone|\.fax|\.contactPhone|documentDriverPhone)$/.test(path);
    // A BOL-only quote cannot establish a pickup/delivery reference, even if
    // both extraction and audit models agree on that incorrect mapping.
    const stopReference = /^(pickup|delivery|stops\.\d+)\.referenceNumber$/.test(path);
    const referenceValue = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pickupRole = path.startsWith('pickup.') || (path.startsWith('stops.') && stops?.[Number(path.split('.')[1])]?.role === 'pickup');
    const referenceLabel = pickupRole ? '(?:pickup|pick\\s*up|PU)' : '(?:delivery|DEL)';
    const explicitStopReference = new RegExp(`\\b${referenceLabel}\\s*(?:#|no\\.?|number|reference)\\s*[:#-]?\\s*${referenceValue}(?=\\s|[;,]|$)`, 'i');
    const bolOnlyReference = stopReference && source.some(item =>
      /\b(?:BOL|bill\s+of\s+lading)\b/i.test(item.quote)
      && !explicitStopReference.test(item.quote));
    const groundedWrongLabel = Boolean(candidate.sourceManifest) && source.some(item =>
      (path === 'loadNumber' && /\b(?:BOL|bill\s+of\s+lading)\b/i.test(item.quote)
        && !/\b(?:load|shipment|order)\s*(?:#|no\.?\b|number\b|id\b)/i.test(item.quote))
      || (path === 'brokerRate' && /\b(?:declared\s+|cargo\s+|insured\s+)?value\b/i.test(item.quote)
        && !/\b(?:total|rate|line\s*haul|carrier\s*pay|freight\s*charge)\b/i.test(item.quote)));
    // City/region is useful for the preview, but is not a dispatch street address.
    const stopData = /\.addressLine$/.test(path) ? get(candidate, path.replace(/\.addressLine$/, '')) : null;
    const addressWords = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const cityOnlyAddress = stopData?.city && [stopData.city,
      `${stopData.city} ${stopData.region ?? ''}`, `${stopData.city} ${stopData.region ?? ''} ${stopData.postalCode ?? ''}`]
      .some(v => addressWords(v) === addressWords(value));
    // A CONTACT/address blob must never become a dialable number even if both models accept it.
    const semanticValid = !bolOnlyReference && !groundedWrongLabel && !cityOnlyAddress && (!phoneField || validPhone(value) != null)
      && (path !== 'weightLbs' || source.some(item => /\b(?:lbs?|pounds?)\b/i.test(item.quote)))
      && (path !== 'freightMode' || !/^[A-Z]$/i.test(String(value)))
      && (!/\.appointment(?:From|To)$/.test(path)
        || !source.some(item => /\bAppt\s*#/i.test(item.quote)));
    const sourceValid = source.length === 1 && validEvidence(source[0]);
    const verificationValid = singlePass
      ? sourceValid && source[0].page <= audit.pageCount
        && !audit.uncertainFields.includes(path)
        && singlePassValueSupported(path, value, source[0].quote)
      : checked.length === 1 && validEvidence(checked[0]) && checked[0].verdict === 'supported'
        && sourceValid && (source[0].page === checked[0].page || normalizeQuote(source[0].quote) === normalizeQuote(checked[0].quote!));
    if (!correctType || (!aiPdfDirect && (!semanticValid || !sourceValid || !verificationValid))) {
      set(safe, path, null);
      rejectedFields.push(path);
      issues.push({ field: path, value, status: !correctType || !semanticValid ? 'conflict' : 'needs_review',
        reason: !sourceValid ? 'missing_source' : !semanticValid ? 'wrong_field' : 'source_mismatch',
        page: source[0]?.page ?? null, quote: source[0]?.quote ?? null });
      continue;
    }
    set(safe, path, value);
    const acceptedSource = singlePass ? source[0] : checked[0];
    fields.push({ ...(acceptedSource ?? {}), key: path, value,
      page: acceptedSource && typeof acceptedSource.page === 'number' && Number.isInteger(acceptedSource.page) && acceptedSource.page > 0 ? acceptedSource.page : null,
      quote: acceptedSource && typeof acceptedSource.quote === 'string' && acceptedSource.quote.trim()
        ? acceptedSource.quote.trim() : null });
  }
  safe.requirements = safe.requirements.filter((value: unknown) => typeof value === 'string');
  safe.contractTerms = safe.contractTerms.filter((value: unknown) => typeof value === 'string');
  const required = ['loadNumber', 'pickup.addressLine', 'pickup.city', 'pickup.region',
    'delivery.addressLine', 'delivery.city', 'delivery.region',
    ...(stops ?? []).flatMap((_: any, i: number) => ['addressLine', 'city', 'region'].map(key => `stops.${i}.${key}`))];
  const blockingFields = [...new Set([...rejectedFields, ...required.filter(key => !get(safe, key))])];
  // The installed mobile workflow still completes one stop of each role.
  // Preserve all stops, but never dispatch a shipment it could finish early.
  if (stops && stops.length > 2) blockingFields.push('multiStopDriverWorkflow');
  if (singlePass) {
    for (const path of audit.uncertainFields) blockingFields.push(Object.hasOwn(paths, path) ? path : 'documentDetails');
    if (aiPdfDirect && !audit.allPagesRead) blockingFields.push('documentDetails');
    for (const stop of ['pickup', 'delivery', ...(stops ?? []).map((_: any, i: number) => `stops.${i}`)]) {
      const from = get(safe, `${stop}.appointmentFrom`), to = get(safe, `${stop}.appointmentTo`);
      if (from && to && Date.parse(to) < Date.parse(from)) blockingFields.push(`${stop}.appointmentTo`);
    }
    const pickupTime = get(safe, 'pickup.appointmentFrom'), deliveryTime = get(safe, 'delivery.appointmentFrom');
    if (pickupTime && deliveryTime && /(?:Z|[+-]\d{2}:\d{2})$/.test(pickupTime)
      && /(?:Z|[+-]\d{2}:\d{2})$/.test(deliveryTime) && Date.parse(deliveryTime) < Date.parse(pickupTime)) {
      blockingFields.push('delivery.appointmentFrom');
    }
  }
  // An auditor can contradict itself by flagging an exact instruction it has
  // already verified. Resolve only literal coverage on that same source page;
  // absent/partial/unverified quotes still block assignment.
  const reportedMissing = Array.isArray(audit.missingOperationalDetails) ? audit.missingOperationalDetails : [];
  const isCorruptContactLabel = (item: any) => typeof item.quote === 'string'
    && /^Phone\s*\/\s*Contact:\s*\/[^\s]+CONTACT$/i.test(item.quote.trim());
  const allReportedDetailsPresent = reportedMissing.length > 0 && reportedMissing.every((item: any) =>
    isCorruptContactLabel(item) || (typeof item.quote === 'string' && normalizeQuote(item.quote).length > 0
    && fields.some(field => field.page === item.page && typeof field.value === 'string'
      && normalizeQuote(field.value).includes(normalizeQuote(item.quote)))));
  if ((audit.operationalRequirementsComplete !== true || reportedMissing.length > 0)
      && !allReportedDetailsPresent) blockingFields.push('requirements');
  // New-protocol documents must also pass the all-pages completeness audit.
  if ((operationalOnly || 'contractTerms' in candidate) && (audit.documentDetailsComplete !== true || audit.missingDocumentDetails?.length > 0)) blockingFields.push('documentDetails');
  if (/reefer|refrigerat/i.test(safe.equipmentType || '') && safe.temperatureFahrenheit == null) {
    blockingFields.push('temperatureFahrenheit');
  }
  const driverFields = fields.filter(field => !STAFF_DOCUMENT_FIELDS.has(field.key) && !field.key.startsWith('contractTerms.') && ![
    'brokerRate', 'loadedMiles', 'broker.fax', 'broker.email',
    'pickup.appointmentFrom', 'pickup.appointmentTo', 'pickup.appointmentTimezone',
    'delivery.appointmentFrom', 'delivery.appointmentTo', 'delivery.appointmentTimezone',
  ].includes(field.key));
  const reviewFields = [...new Set([...blockingFields, ...(aiPdfDirect ? ['documentDetails'] : [])])];
  return {
    safe,
    missingFields,
    review: { required: true, blockingFields: dispatchBlockingFields(reviewFields),
      warningFields: dispatchWarningFields(reviewFields), rejectedFields, issues,
      method: aiPdfDirect ? 'ai_pdf_direct' : candidate.sourceManifest ? 'pdf_source_rules' : singlePass ? 'single_pass_rules' : 'independent_model_audit',
      sourceGrounded: Boolean(candidate.sourceManifest), independentAudit: !singlePass },
    documentDetails: { version: 3, ...(operationalOnly ? { extractionScope: OPERATIONAL_EXTRACTION_SCOPE } : {}), fields, stops: safe.stops, issues, unknownFields: [...new Set([...missingFields, ...rejectedFields])] },
    driverBrief: { version: 1, ...(operationalOnly ? { extractionScope: OPERATIONAL_EXTRACTION_SCOPE } : {}), fields: driverFields, stops: safe.stops, unknownFields: [...new Set([...missingFields, ...rejectedFields])] },
  };
}

export const verificationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    documentReadable: { type: 'boolean' }, singleLoad: { type: 'boolean' },
    pickupCount: { type: 'integer' }, deliveryCount: { type: 'integer' },
    operationalRequirementsComplete: { type: 'boolean' },
    documentDetailsComplete: { type: 'boolean' },
    missingDocumentDetails: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { page: { type: 'integer' }, quote: { type: 'string' } }, required: ['page', 'quote'] } },
    missingOperationalDetails: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { page: { type: 'integer' }, quote: { type: 'string' } }, required: ['page', 'quote'] } },
    fields: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        field: { type: 'string', enum: EVIDENCE_PATHS }, verdict: { type: 'string', enum: ['supported', 'uncertain', 'contradicted'] },
        page: { type: ['integer', 'null'] }, quote: { type: ['string', 'null'] },
      }, required: ['field', 'verdict', 'page', 'quote'],
    } },
  }, required: ['documentReadable', 'singleLoad', 'pickupCount', 'deliveryCount', 'operationalRequirementsComplete', 'missingOperationalDetails', 'documentDetailsComplete', 'missingDocumentDetails', 'fields'],
};
