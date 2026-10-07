import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operationalExtractionSchemas, isOperationalExtractionField, OPERATIONAL_EXTRACTION_SCOPE,
  OPERATIONAL_DOCUMENT_FIELDS, OPERATIONAL_STOP_FIELDS, OPERATIONAL_DOCUMENT_INSTRUCTIONS } from '../../supabase/functions/_shared/load-operational-extraction.ts';
import { FIELD_TYPES, verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';
import { documentReviewSchema } from '../../supabase/functions/_shared/load-single-pass.ts';
import { sourcedExtractionSchema, decodeSourcedExtraction } from '../../supabase/functions/_shared/load-sourced-fields.ts';
import { issueLoadPreviewTicket, verifyLoadPreviewTicket } from '../../supabase/functions/_shared/load-preview-ticket.ts';
import { DOCUMENT_EXTRACTION_VERSION } from '../../supabase/functions/_shared/load-document-fields.ts';
import { buildImportedLoad } from '../components/importedLoadModel.js';

const fact = (value, quote = String(value), page = 1) => ({ value, page, quote });
function sample() {
  return {
    loadNumber: fact('LOAD-42'), broker: { name: fact('Broker LLC'), contactName: fact('Nick'),
      phone: fact('320-760-3209'), email: fact('broker@example.com') },
    brokerRate: fact(1000, 'Total $1,000'), loadedMiles: fact(0, 'Miles 0'),
    cargoDescription: fact('Generator'), equipmentType: fact('Flatbed'),
    weightLbs: fact(1800, 'Weight 1,800 lbs'), weightPrinted: fact('1,800 lbs'),
    temperatureFahrenheit: fact(-10, 'Temperature -10 F'), isHazmat: fact(false, 'Hazmat: No'),
    bolNumber: fact('BOL-42'), requirements: [{ value: 'Wait for approval before unloading.', page: 4 }],
    documentReview: { documentReadable: true, singleLoad: true, allPagesRead: true, pageCount: 4,
      operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] },
    stops: [
      { role: 'pickup', addressLine: fact('25 Gill Ave'), city: fact('Rockaway'), region: fact('NJ'),
        scheduledDate: fact('2026-10-01', 'Date: 10/01/2026'), timePrinted: fact('07:00-15:30'),
        contactPhone: fact('973-791-1323'), referenceNumber: fact('PU-1', 'Pickup # PU-1'),
        note: fact('Send loaded photos before leaving.') },
      { role: 'delivery', addressLine: fact('7027 W Brightwater Way'), city: fact('Tucson'), region: fact('AZ'),
        contactPhone: fact('520-981-3840'), referenceNumber: fact('DEL-1', 'Delivery # DEL-1'),
        timingNote: fact('Any day, anytime, give notice.') },
    ],
  };
}
const decode = wire => ({ ...decodeSourcedExtraction(wire), extractionScope: OPERATIONAL_EXTRACTION_SCOPE });
const verify = wire => verifyLoadExtraction(decode(wire), null, true);

test('compact strict schema omits legal/payment/identity output but retains all dispatch facts', () => {
  const types = Object.fromEntries(Object.entries(FIELD_TYPES).filter(([key]) => !key.includes('.'))
    .map(([key, type]) => [key, { type: [type, 'null'] }]));
  const broker = Object.fromEntries(Object.entries(FIELD_TYPES).filter(([key]) => key.startsWith('broker.'))
    .map(([key]) => [key.slice(7), { type: ['string', 'null'] }]));
  const stop = { properties: Object.fromEntries(Object.entries(FIELD_TYPES).filter(([key]) => key.startsWith('pickup.'))
    .map(([key]) => [key.slice(7), { type: ['string', 'null'] }])) };
  const full = { properties: { ...types, broker: { properties: broker }, documentReview: documentReviewSchema,
    requirements: { type: 'array' }, contractTerms: { type: 'array' } } };
  const before = JSON.stringify(full);
  const compact = operationalExtractionSchemas(full, stop);
  const schema = sourcedExtractionSchema(compact.document, compact.stop);
  assert.equal(JSON.stringify(full), before);
  for (const key of OPERATIONAL_DOCUMENT_FIELDS) assert.ok(schema.properties[key], key);
  for (const key of OPERATIONAL_STOP_FIELDS) assert.ok(schema.properties.stops.items.properties[key], key);
  for (const key of ['contractTerms', 'paymentTerms', 'billingEmail', 'carrierName', 'documentDriverName', 'serialNumber', 'cargoValuePrinted']) {
    assert.equal(schema.properties[key], undefined, key);
  }
  assert.equal(schema.properties.broker.properties.fax, undefined);
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.stops.maxItems, 25);
  assert.deepEqual(schema.properties.requirements.items.required, ['value', 'page']);
  assert.ok(JSON.stringify(schema).length < JSON.stringify(sourcedExtractionSchema(full, stop)).length);
  assert.throws(() => operationalExtractionSchemas({ properties: {} }, stop), /Missing extraction schema|Cannot read/);
});

test('compact extraction flows into the existing table with amounts, contacts, date-only stops and requirements', () => {
  const result = verify(sample());
  assert.deepEqual(result.review.blockingFields, []);
  const table = buildImportedLoad({ documentDetails: result.documentDetails, review: result.review });
  assert.equal(table.operationalOnly, true);
  assert.equal(table.number, 'LOAD-42');
  assert.equal(table.rate, 1000); assert.equal(table.distance, 0); assert.equal(table.rpm, null);
  assert.equal(table.weight, 1800); assert.equal(table.temperature, -10); assert.equal(table.hazmat, false);
  assert.equal(table.brokerEmail, 'broker@example.com'); assert.equal(table.brokerPhone, '320-760-3209');
  assert.equal(table.pickup.scheduledDate, '2026-10-01'); assert.equal(table.pickup.timePrinted, '07:00-15:30');
  assert.equal(table.delivery.scheduledDate, null); assert.equal(table.delivery.timePrinted, null);
  assert.equal(table.pickup.reference, 'PU-1'); assert.equal(table.delivery.reference, 'DEL-1');
  assert.deepEqual(table.requirements, ['Wait for approval before unloading.']);
  for (const key of ['paymentTerms', 'carrierName', 'palletCount', 'broker.fax']) {
    assert.ok(!result.missingFields.includes(key));
    assert.ok(!result.documentDetails.unknownFields.includes(key));
  }
});

test('multiple pickups and deliveries keep their own order, references, times and instructions', () => {
  const wire = sample();
  wire.stops.splice(1, 0,
    { role: 'pickup', addressLine: fact('1 Main St'), city: fact('Dallas'), region: fact('TX'), referenceNumber: fact('PU-2', 'Pickup # PU-2'), timePrinted: fact('08:30') },
    { role: 'delivery', addressLine: fact('2 First Ave'), city: fact('Phoenix'), region: fact('AZ'), referenceNumber: fact('DEL-2', 'Delivery # DEL-2'), note: fact('Call 30 minutes before arrival.') });
  const result = verify(wire);
  const table = buildImportedLoad({ documentDetails: result.documentDetails });
  assert.deepEqual(table.stops.map(s => s.role), ['pickup', 'pickup', 'delivery', 'delivery']);
  assert.deepEqual(table.stops.map(s => s.reference), ['PU-1', 'PU-2', 'DEL-2', 'DEL-1']);
  assert.equal(table.stops[1].timePrinted, '08:30'); assert.equal(table.stops[2].note, 'Call 30 minutes before arrival.');
  // Do not silently weaken the existing mobile multi-stop workflow guard.
  assert.ok(result.review.blockingFields.includes('multiStopDriverWorkflow'));
});

test('compact scope retains unreadable-page, missing-stop, instruction, weight and reefer safeguards', () => {
  const incomplete = sample(); incomplete.documentReview.allPagesRead = false;
  assert.throws(() => verify(incomplete), /sahifalari/);
  incomplete.documentReview.allPagesRead = true; incomplete.documentReview.documentDetailsComplete = false;
  assert.ok(verify(incomplete).review.warningFields.includes('documentDetails'));
  incomplete.documentReview.operationalRequirementsComplete = false;
  assert.ok(verify(incomplete).review.blockingFields.includes('requirements'));
  const noStreet = sample(); noStreet.stops[1].addressLine = fact(null);
  assert.ok(verify(noStreet).review.blockingFields.includes('stops.1.addressLine'));
  const badWeight = sample(); badWeight.weightLbs = fact(1800, 'Weight 1800');
  assert.ok(verify(badWeight).review.blockingFields.includes('weightLbs'));
  const reefer = sample(); reefer.equipmentType = fact('Reefer'); reefer.temperatureFahrenheit = fact(null);
  assert.ok(verify(reefer).review.blockingFields.includes('temperatureFahrenheit'));
});

test('server scope is signed, survives confirmation and rejects old extraction versions', async () => {
  const candidate = decode(sample());
  const binding = { actorId: 'actor', companyId: 'company', checksum: 'sha', fileName: 'load.pdf', mimeType: 'application/pdf', version: DOCUMENT_EXTRACTION_VERSION + 2 };
  const ticket = await issueLoadPreviewTicket(candidate, binding, 'test-only-secret');
  const restored = await verifyLoadPreviewTicket(ticket, binding, 'test-only-secret');
  assert.equal(restored.extractionScope, OPERATIONAL_EXTRACTION_SCOPE);
  assert.equal(verifyLoadExtraction(restored, null, true).documentDetails.extractionScope, OPERATIONAL_EXTRACTION_SCOPE);
  await assert.rejects(verifyLoadPreviewTicket(ticket, { ...binding, version: binding.version - 1 }, 'test-only-secret'));
});

test('historical full-document snapshots retain their payment and legal fields', () => {
  const wire = sample(); wire.paymentTerms = fact('Net 30'); wire.contractTerms = [{ value: 'Full historical contract.', page: 4 }];
  const original = decodeSourcedExtraction(wire);
  const before = JSON.stringify(original);
  const legacy = verifyLoadExtraction(original, null, true);
  assert.equal(legacy.safe.paymentTerms, 'Net 30');
  assert.deepEqual(legacy.safe.contractTerms, ['Full historical contract.']);
  assert.equal(buildImportedLoad({ documentDetails: legacy.documentDetails }).operationalOnly, false);
  assert.equal(JSON.stringify(original), before);
  const compact = verifyLoadExtraction({ ...original, extractionScope: OPERATIONAL_EXTRACTION_SCOPE }, null, true);
  assert.ok(!compact.documentDetails.fields.some(f => f.key === 'paymentTerms' || f.key.startsWith('contractTerms.')));
});

test('only the new parser selects compact scope; scope never comes from the model schema', () => {
  const source = readFileSync(new URL('../../supabase/functions/parse-load-document/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('operationalExtractionSchemas(extractionSchema, stopSchema)'));
  assert.ok(source.includes('schema: sourcedExtractionSchema(compact.document, compact.stop)'));
  assert.ok(source.includes('candidate.extractionScope = OPERATIONAL_EXTRACTION_SCOPE'));
  assert.ok(source.includes('instructions: OPERATIONAL_DOCUMENT_INSTRUCTIONS'));
  assert.ok(!source.includes('instructions: DOCUMENT_DETAIL_INSTRUCTIONS'));
  assert.match(OPERATIONAL_DOCUMENT_INSTRUCTIONS, /Read EVERY page/);
  assert.match(OPERATIONAL_DOCUMENT_INSTRUCTIONS, /ALL pickup\/delivery stops/);
  assert.match(OPERATIONAL_DOCUMENT_INSTRUCTIONS, /conditions and exceptions/);
  assert.equal(isOperationalExtractionField('contractTerms.0'), false);
  assert.equal(isOperationalExtractionField('requirements.0'), true);
  assert.equal(isOperationalExtractionField('stops.24.referenceNumber'), true);
});
