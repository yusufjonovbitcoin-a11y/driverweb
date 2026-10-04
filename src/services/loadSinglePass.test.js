import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSinglePassExtraction, singlePassValueSupported } from '../../supabase/functions/_shared/load-single-pass.ts';
import { verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';

function candidate() {
  const value = { loadNumber: 'LOAD-42', pickupCount: 1, deliveryCount: 1,
    pickup: { addressLine: '100 First Ave', city: 'Phoenix', region: 'AZ' },
    delivery: { addressLine: '200 Second Ave', city: 'Dallas', region: 'TX' },
    requirements: ['Keep seal intact.'], contractTerms: [],
    documentReview: { documentReadable: true, singleLoad: true, allPagesRead: true, pageCount: 2,
      operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] }, evidence: [] };
  for (const [field, text] of Object.entries({ loadNumber: value.loadNumber, 'requirements.0': value.requirements[0],
    ...Object.fromEntries(['pickup', 'delivery'].flatMap(stop => Object.entries(value[stop]).map(([k,v]) => [`${stop}.${k}`, v]))) })) {
    value.evidence.push({ field, quote: `${field}: ${text}`, page: 1 });
  }
  return value;
}
const verify = value => verifyLoadExtraction(value, null, true);

test('one AI request produces rule-checked data, never a fabricated independent audit', async () => {
  let calls = 0;
  const result = await runSinglePassExtraction(async () => { calls++; return candidate(); }, verify);
  assert.equal(calls, 1);
  assert.deepEqual(result.verified.review.blockingFields, []);
  assert.equal(result.verified.review.required, true);
  assert.equal(result.verified.review.independentAudit, false);
  assert.equal(result.audit.method, 'single_pass_rules');
});
test('warnings, provider errors and malformed data never trigger another paid request', async () => {
  let calls = 0;
  const value = candidate(); value.documentReview.uncertainFields = ['loadNumber'];
  const result = await runSinglePassExtraction(async () => { calls++; return value; }, verify);
  assert.equal(calls, 1); assert.equal(result.verified.safe.loadNumber, null);
  assert.ok(result.verified.review.blockingFields.includes('loadNumber'));
  await assert.rejects(runSinglePassExtraction(async () => { calls++; throw Error('timeout'); }, verify));
  assert.equal(calls, 2);
});
test('missing pages, multiple stops, invalid evidence and missing identifiers fail closed', () => {
  for (const change of [v => { v.documentReview.allPagesRead = false; }, v => { v.pickupCount = 2; }, v => { v.documentReview = null; }]) {
    const v = candidate(); change(v); assert.throws(() => verify(v));
  }
  for (const change of [v => { v.evidence[0].page = 3; }, v => { v.evidence[0].quote = 'Load: WRONG'; },
    v => { v.evidence.push(v.evidence[0]); }, v => { v.loadNumber = null; }]) {
    const v = candidate(); change(v); assert.ok(verify(v).review.blockingFields.includes('loadNumber'));
  }
});
test('numbers, units, phone, email, uncertainty and completeness are checked without AI', () => {
  assert.equal(singlePassValueSupported('brokerRate', 3000, 'Rate: $3,000.00'), true);
  assert.equal(singlePassValueSupported('temperatureFahrenheit', -10, 'Temperature: 10 F'), false);
  assert.equal(singlePassValueSupported('loadNumber', '42', 'Load: 142'), false);
  assert.equal(singlePassValueSupported('broker.email', 'broken@', 'Email broken@'), false);
  assert.equal(singlePassValueSupported('isHazmat', false, 'Not specified'), false);
  assert.equal(singlePassValueSupported('isHazmat', true, 'HAZMAT UN1993 AND TANKER ENDORSED'), true);
  assert.equal(singlePassValueSupported('isHazmat', false, 'HAZMAT UN1993 AND TANKER ENDORSED'), false);
  const v = candidate(); v.weightLbs = 1800; v.evidence.push({field:'weightLbs',page:1,quote:'Weight 1800'});
  v.documentReview.documentDetailsComplete = false;
  const result = verify(v);
  assert.ok(result.review.blockingFields.includes('weightLbs'));
  assert.ok(result.review.warningFields.includes('documentDetails'));
});
test('timestamp normalization accepts printed US times but rejects invented dates, offsets and impossible dates', () => {
  assert.equal(singlePassValueSupported('pickup.appointmentFrom', '2026-10-01T14:30:00', 'Appointment: 10/01/2026 2:30 PM'), true);
  assert.equal(singlePassValueSupported('pickup.appointmentFrom', '2026-10-01T14:30:00', 'October 1, 2026 14:30'), true);
  for (const [time, quote] of [['2026-10-02T14:30:00', 'October 1, 2026 14:30'],
    ['2026-02-30T14:30:00','2026-02-30T14:30:00'], ['2026-10-01T14:30:00Z','October 1, 2026 14:30'],
    ['2026-10-01T01:30:00', '10/01/2026 11:30']]) {
    assert.equal(singlePassValueSupported('pickup.appointmentFrom', time, quote), false);
  }
});
test('reversed appointment window remains blocked', () => {
  const v = candidate();
  for (const [key, time] of [['appointmentFrom','2026-10-01T14:30:00'],['appointmentTo','2026-10-01T10:30:00']]) {
    v.pickup[key] = time; v.evidence.push({field:`pickup.${key}`,quote:time,page:1});
  }
  assert.ok(verify(v).review.blockingFields.includes('pickup.appointmentTo'));
});
test('deployed parser path has no automatic AI audit or repair loop', () => {
  const source = readFileSync(new URL('../../supabase/functions/parse-load-document/index.ts', import.meta.url), 'utf8');
  const flow = source.slice(source.indexOf('async function extractAndVerify'), source.indexOf('function stopPayload'));
  assert.equal((flow.match(/extractLoad\(/g) || []).length, 1);
  assert.ok(flow.includes('runSinglePassExtraction'));
  assert.ok(!/if\s*\([^)]*blockingFields/.test(flow));
  assert.ok(source.includes("payload.status !== 'completed'"));
});
