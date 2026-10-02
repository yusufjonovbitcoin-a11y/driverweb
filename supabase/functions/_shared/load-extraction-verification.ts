// Model output is untrusted. Only independently supported fields enter the brief.
import { validPhone } from './load-enrichment.ts';
import { EXTRA_DOCUMENT_FIELDS, EXTRA_STOP_FIELDS, STAFF_DOCUMENT_FIELDS } from './load-document-fields.ts';
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

type Evidence = { field: string; page: number; quote: string };
type Review = { field: string; verdict: string; page: number | null; quote: string | null };
const get = (data: any, path: string) => path.split('.').reduce((value, key) => value?.[key], data);
const normalizeQuote = (value: string) => value.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
function set(data: any, path: string, value: unknown) {
  const keys = path.split('.');
  let parent = data;
  for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
  parent[keys.at(-1)!] = value;
}

export function verifyLoadExtraction(candidate: any, audit: any) {
  if (!candidate || !audit || audit.documentReadable !== true || audit.singleLoad !== true
      || candidate.pickupCount !== 1 || candidate.deliveryCount !== 1
      || audit.pickupCount !== 1 || audit.deliveryCount !== 1) {
    throw new Error('Hujjat aniq bitta yuk, bitta pickup va bitta deliveryni ko‘rsatishi kerak. To‘liq va tiniq hujjat yuklang.');
  }
  const canonical = (item: any) => ({ ...item, field: String(item?.field ?? '').replace(/\[(\d+)\]/g, '.$1') });
  const evidence: Evidence[] = Array.isArray(candidate.evidence) ? candidate.evidence.map(canonical) : [];
  const reviews: Review[] = Array.isArray(audit.fields) ? audit.fields.map(canonical) : [];
  const safe: any = { broker: {}, pickup: {}, delivery: {}, requirements: [], contractTerms: [] };
  const fields: Array<{ key: string; value: unknown; page: number; quote: string }> = [];
  const rejectedFields: string[] = [];
  const missingFields: string[] = [];
  const paths = { ...FIELD_TYPES, ...Object.fromEntries(
    ['requirements', 'contractTerms'].flatMap(key => (Array.isArray(candidate[key]) ? candidate[key] : []).map((_: unknown, index: number) => [`${key}.${index}`, 'string'])),
  ) };
  for (const [path, type] of Object.entries(paths)) {
    const raw = get(candidate, path);
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value == null || value === '') {
      set(safe, path, null);
      missingFields.push(path);
      continue;
    }
    const source = evidence.filter(item => item?.field === path);
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
    const stopReference = /^(pickup|delivery)\.referenceNumber$/.test(path);
    const referenceValue = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const referenceLabel = path.startsWith('pickup.') ? '(?:pickup|pick\\s*up|PU)' : '(?:delivery|DEL)';
    const explicitStopReference = new RegExp(`\\b${referenceLabel}\\s*(?:#|no\\.?|number|reference)\\s*[:#-]?\\s*${referenceValue}(?=\\s|[;,]|$)`, 'i');
    const bolOnlyReference = stopReference && source.some(item =>
      /\b(?:BOL|bill\s+of\s+lading)\b/i.test(item.quote)
      && !explicitStopReference.test(item.quote));
    // A CONTACT/address blob must never become a dialable number even if both models accept it.
    const semanticValid = !bolOnlyReference && (!phoneField || validPhone(value) != null)
      && (path !== 'weightLbs' || source.some(item => /\b(?:lbs?|pounds?)\b/i.test(item.quote)))
      && (path !== 'freightMode' || !/^[A-Z]$/i.test(String(value)))
      && (!/\.appointment(?:From|To)$/.test(path)
        || !source.some(item => /\bAppt\s*#/i.test(item.quote)));
    if (!correctType || !semanticValid || source.length !== 1 || checked.length !== 1
        || !validEvidence(source[0]) || !validEvidence(checked[0])
        || checked[0].verdict !== 'supported'
        || (source[0].page !== checked[0].page && normalizeQuote(source[0].quote) !== normalizeQuote(checked[0].quote!))) {
      set(safe, path, null);
      rejectedFields.push(path);
      continue;
    }
    set(safe, path, value);
    fields.push({ key: path, value, page: checked[0].page!, quote: checked[0].quote!.trim() });
  }
  safe.requirements = safe.requirements.filter((value: unknown) => typeof value === 'string');
  safe.contractTerms = safe.contractTerms.filter((value: unknown) => typeof value === 'string');
  const required = ['loadNumber', 'pickup.addressLine', 'pickup.city', 'pickup.region',
    'delivery.addressLine', 'delivery.city', 'delivery.region'];
  const blockingFields = [...new Set([...rejectedFields, ...required.filter(key => !get(safe, key))])];
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
  if ('contractTerms' in candidate && (audit.documentDetailsComplete !== true || audit.missingDocumentDetails?.length > 0)) blockingFields.push('documentDetails');
  if (/reefer|refrigerat/i.test(safe.equipmentType || '') && safe.temperatureFahrenheit == null) {
    blockingFields.push('temperatureFahrenheit');
  }
  const driverFields = fields.filter(field => !STAFF_DOCUMENT_FIELDS.has(field.key) && !field.key.startsWith('contractTerms.') && ![
    'brokerRate', 'loadedMiles', 'broker.fax', 'broker.email',
    'pickup.appointmentFrom', 'pickup.appointmentTo', 'pickup.appointmentTimezone',
    'delivery.appointmentFrom', 'delivery.appointmentTo', 'delivery.appointmentTimezone',
  ].includes(field.key));
  return {
    safe,
    missingFields,
    review: { required: true, blockingFields: [...new Set(blockingFields)], rejectedFields },
    documentDetails: { version: 2, fields, unknownFields: [...new Set([...missingFields, ...rejectedFields])] },
    driverBrief: { version: 1, fields: driverFields, unknownFields: [...new Set([...missingFields, ...rejectedFields])] },
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
