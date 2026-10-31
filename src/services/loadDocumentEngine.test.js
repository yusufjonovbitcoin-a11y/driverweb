import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDocumentEngine } from '../../supabase/functions/_shared/load-document-engine.ts';
import { verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';
import { documentTokenCost } from '../../supabase/functions/_shared/load-document-cost.ts';
import { LoadPreviewCache, previewCacheKey } from '../../supabase/functions/_shared/load-preview-cache.ts';

const review = () => ({ documentReadable: true, singleLoad: true, allPagesRead: true,
  pageCount: 1, operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] });
const source = lines => ({ version: 1, checksum: 'a'.repeat(64), engine: 'test-native', pageCount: 1,
  pages: [{ number: 1, width: 600, height: 800, ocr: false, blocks: lines.map((text, i) => ({
    id: `page_1_block_${i}_line_0`, text, bbox: [30, 30 + i * 35, 550, 45 + i * 35],
  })) }] });
const fact = (value, ...source_ids) => ({ value, source_ids });
const wire = extra => ({ broker: {}, stops: [], requirements: [], contractTerms: [], documentReview: review(), ...extra });

test('BOL number and bill-to party cannot be accepted as load and broker', () => {
  const pdf = source(['BILL OF LADING', 'Bill of Lading Number: 0098765', 'Bill To: Independent']);
  const result = decodeDocumentEngine(wire({ loadNumber: fact('0098765', 'p1b1'),
    bolNumber: fact('0098765', 'p1b1'), broker: { name: fact('Independent', 'p1b2') } }), pdf);
  assert.equal(result.loadNumber, null);
  assert.equal(result.bolNumber, '0098765');
  assert.equal(result.broker.name, null);
});

test('a Rate Con mentioning BOL instructions remains a rate confirmation', () => {
  const pdf = source(['Load Confirmation', 'Order# ABC987', 'BILL OF LADING MUST BE SENT', 'Total Rate $700.00']);
  const result = decodeDocumentEngine(wire({ loadNumber: fact('ABC987', 'p1b1'), brokerRate: fact(700, 'p1b3') }), pdf);
  assert.equal(result.documentType, 'rate_confirmation');
  assert.equal(result.brokerRate, 700);
});

test('a source value from an invented ID and an unsupported weight unit are rejected', () => {
  const result = decodeDocumentEngine(wire({ cargoDescription: fact('invented cargo', 'p1b999'),
    weightLbs: fact(25000, 'p1b1') }), source(['Rate Confirmation', 'Weight: 25000']));
  assert.equal(result.cargoDescription, null);
  assert.equal(result.weightLbs, null);
});

test('a delivery cannot borrow an explicitly labelled pickup date', () => {
  const pdf = source(['Rate Confirmation', 'Pickup', 'Delivery', 'Pick Up: September 24, 2026 @ 1 PM']);
  const result = decodeDocumentEngine(wire({ stops: [
    { role: 'pickup', anchor_ids: ['p1b1'] },
    { role: 'delivery', anchor_ids: ['p1b2'], scheduledDate: fact('2026-09-24', 'p1b3') },
  ] }), pdf);
  assert.equal(result.stops[1].scheduledDate, null);
  assert.ok(result.engineIssues.some(issue => issue.reason === 'wrong_stop'));
});

test('two printed ZIPs for the same street are surfaced with both alternatives', () => {
  const pdf = source(['Rate Confirmation', 'Delivery', '120 Test Street, Sample, PA 19001', '120 Test St, Sample, Pennsylvania 19002']);
  const result = decodeDocumentEngine(wire({ stops: [{ role: 'delivery', anchor_ids: ['p1b1'],
    addressLine: fact('120 Test St', 'p1b2'), postalCode: fact('19001', 'p1b2') }] }), pdf);
  assert.equal(result.stops[0].postalCode, null);
  assert.deepEqual(result.engineIssues.find(issue => issue.reason === 'conflicting_postal_codes').alternatives, ['19001', '19002']);
});

test('printed stop order wins over date order', () => {
  const pdf = source(['Rate Confirmation', 'Pickup', 'Delivery Erie', 'Delivery Beaver']);
  const result = decodeDocumentEngine(wire({ stops: [
    { role: 'pickup', anchor_ids: ['p1b1'] },
    { role: 'delivery', anchor_ids: ['p1b3'], city: fact('Beaver', 'p1b3') },
    { role: 'delivery', anchor_ids: ['p1b2'], city: fact('Erie', 'p1b2') },
  ] }), pdf);
  assert.deepEqual(result.stops.map(stop => stop.city), [undefined, 'Erie', 'Beaver']);
});

test('the complete condition and penalty remain verbatim even when the model omits the instruction', () => {
  const condition = 'Driver must submit the POD within 24 hours of delivery unless the receiver retains it. Failure results in a $100 deduction.';
  const result = decodeDocumentEngine(wire({}), source(['Rate Confirmation', condition]));
  assert.ok(result.requirements.includes(condition));
  assert.equal(result.evidence.find(entry => entry.field === 'requirements.0').quote, condition);
});

test('uniquely printed load labels restore an omitted value with genuine source evidence', () => {
  const result = decodeDocumentEngine(wire({}), source(['Rate Confirmation', 'Load # ABC987']));
  assert.equal(result.loadNumber, 'ABC987');
  assert.equal(result.sourceRepairs[0].reason, 'unique_explicit_source_label');
  assert.equal(result.evidence.find(entry => entry.field === 'loadNumber').sourceChecksum, 'a'.repeat(64));
});

test('load-by-load legal prose cannot fabricate an identifier or conflict with an explicit load', () => {
  const result = decodeDocumentEngine(wire({}), source(['Rate Confirmation', 'Load # ABC987', 'Payment is on a load-by-load basis.', 'Load: Must be fully secured.']));
  assert.equal(result.loadNumber, 'ABC987');
  assert.ok(!result.engineIssues.some(issue => issue.reason === 'conflicting_load_numbers'));
});

test('numeric units, combined date/time and shared table headers survive independent final verification', () => {
  const pdf = source(['Load Confirmation', 'Load # TEST-84', 'Stops / Actions', 'Pickup',
    '10/15/26 12:00', '1 Test Road', 'Phoenix, AZ', 'Delivery', '10/16/26 20:00',
    '2 Other Road', 'Dallas, TX', 'Continuous run 34 F', 'Van, HazMat']);
  const result = decodeDocumentEngine(wire({ loadNumber: fact('TEST-84', 'p1b1'),
    temperatureFahrenheit: fact('34 F', 'p1b11'), isHazmat: fact(true, 'p1b12'), stops: [
      { role: 'pickup', anchor_ids: ['p1b2', 'p1b3'], scheduledDate: fact('10/15/26 12:00', 'p1b4'), city: fact('Phoenix', 'p1b6') },
      { role: 'delivery', anchor_ids: ['p1b2', 'p1b7'], scheduledDate: fact('10/16/26 20:00', 'p1b8'), city: fact('Dallas', 'p1b10') },
    ] }), pdf);
  const final = verifyLoadExtraction(result, null, true);
  assert.equal(final.safe.temperatureFahrenheit, 34);
  assert.equal(final.safe.isHazmat, true);
  assert.equal(final.safe.stops[0].scheduledDate, '10/15/26');
  assert.equal(final.safe.stops[0].timePrinted, '12:00');
  assert.equal(final.safe.stops[1].city, 'Dallas');
});

test('generic hazardous legal obligations cannot establish shipment hazmat status', () => {
  const result = decodeDocumentEngine(wire({ isHazmat: fact(true, 'p1b1') }), source([
    'Rate Confirmation', 'Carrier must have insurance for hazardous materials when applicable.',
  ]));
  assert.equal(result.isHazmat, null);
});

test('a shared table anchor is reconstructed from distinct source-supported locations', () => {
  const pdf = source(['Load Confirmation', 'Stops / Actions', 'Pickup', '1 First Road',
    'Phoenix, AZ', 'Delivery', '2 Second Road', 'Dallas, TX']);
  const result = decodeDocumentEngine(wire({ stops: [
    { role: 'pickup', anchor_ids: ['p1b1'], addressLine: fact('1 First Road', 'p1b3'), city: fact('Phoenix', 'p1b4') },
    { role: 'delivery', anchor_ids: ['p1b1'], addressLine: fact('2 Second Road', 'p1b6'), city: fact('Dallas', 'p1b7') },
  ] }), pdf);
  assert.equal(result.stops[0].city, 'Phoenix');
  assert.equal(result.stops[1].city, 'Dallas');
});

test('independently printed contradictory freight totals cannot silently choose one', () => {
  const result = decodeDocumentEngine(wire({ brokerRate: fact(1000, 'p1b1') }), source([
    'Rate Confirmation', 'Total Freight Rate: $1,000.00', 'Total Freight Rate: $1,250.00',
  ]));
  assert.equal(result.brokerRate, null);
  assert.deepEqual(result.engineIssues.find(issue => issue.reason === 'conflicting_freight_rates').alternatives, [1000, 1250]);
});

test('a model cannot certify fewer pages than the trusted PDF manifest', () => {
  const value = wire({}); value.documentReview.pageCount = 2;
  assert.throws(() => decodeDocumentEngine(value, source(['Rate Confirmation'])), /PAGE_COVERAGE_MISMATCH/);
});

test('cache separates tenants, actors and models and coalesces concurrent identical requests', async () => {
  const cache = new LoadPreviewCache(); let calls = 0;
  const create = async () => { calls++; return { load: 'original' }; };
  const key = previewCacheKey('actor', 'tenant-a', 'hash', 1001, 'mini');
  const [first, second] = await Promise.all([cache.getOrCreate(key, create), cache.getOrCreate(key, create)]);
  assert.equal(calls, 1); assert.equal(second.hit, true);
  first.value.load = 'modified browser copy';
  assert.equal((await cache.getOrCreate(key, create)).value.load, 'original');
  await cache.getOrCreate(previewCacheKey('actor', 'tenant-b', 'hash', 1001, 'mini'), create);
  await cache.getOrCreate(previewCacheKey('actor-2', 'tenant-a', 'hash', 1001, 'mini'), create);
  await cache.getOrCreate(previewCacheKey('actor', 'tenant-a', 'hash', 1001, 'strong'), create);
  assert.equal(calls, 4);
});

test('failed extraction is retried normally and never cached', async () => {
  const cache = new LoadPreviewCache();
  await assert.rejects(cache.getOrCreate('test', async () => { throw Error('provider failed'); }));
  const result = await cache.getOrCreate('test', async () => 'recovered');
  assert.equal(result.hit, false); assert.equal(result.value, 'recovered');
});

test('cost estimates include cached input discounts and never guess unknown model prices', () => {
  assert.equal(documentTokenCost('gpt-4.1-mini-2025-04-14', {
    input_tokens: 1000, input_tokens_details: { cached_tokens: 500 }, output_tokens: 100,
  }), 0.00041);
  assert.equal(documentTokenCost('unpriced-model', { input_tokens: 1000, output_tokens: 100 }), null);
});
