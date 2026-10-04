import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';

function fixture() {
  const values = {
    loadNumber: 'EXACT-10', pickup: { addressLine: '100 First Ave', city: 'Phoenix', region: 'AZ' },
    delivery: { addressLine: '200 Second Ave', city: 'Los Angeles', region: 'CA' },
    temperatureFahrenheit: -10, palletCount: 0, isHazmat: false,
    pickupCount: 1, deliveryCount: 1, requirements: ['Keep seal intact.'],
  };
  const evidence = [];
  function walk(value, path = '') {
    for (const [key, child] of Object.entries(value)) {
      if (['pickupCount', 'deliveryCount'].includes(key)) continue;
      const field = path ? `${path}.${key}` : key;
      if (child && typeof child === 'object') walk(child, field);
      else evidence.push({ field, page: 1, quote: `${field}: ${child}` });
    }
  }
  walk(values);
  return { candidate: { ...values, evidence }, audit: {
    documentReadable: true, singleLoad: true, pickupCount: 1, deliveryCount: 1,
    operationalRequirementsComplete: true,
    fields: evidence.map(item => ({ ...item, verdict: 'supported' })),
  } };
}

function addField(candidate, audit, field, value, page = 1) {
  const keys = field.split('.');
  let parent = candidate;
  for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
  parent[keys.at(-1)] = value;
  const source = { field, page, quote: `${field}: ${value}` };
  candidate.evidence.push(source); audit.fields.push({ ...source, verdict: 'supported' });
}

test('AI PDF verification separates a delivery appointment code from its street address', () => {
  const { candidate } = fixture();
  candidate.extractionMode = 'ai_pdf_direct';
  candidate.stops = [
    { role: 'pickup', addressLine: '777 S 67TH AVE', city: 'PHOENIX', region: 'AZ' },
    { role: 'delivery', addressLine: '1222MS925 488 PARRIOTT PLACE', city: 'CITY OF INDUSTRY',
      region: 'CA', appointmentReference: '1222MS925' },
  ];
  candidate.documentReview = { documentReadable: true, singleLoad: true, pageCount: 6, allPagesRead: true,
    operationalRequirementsComplete: true, uncertainFields: [] };
  const result = verifyLoadExtraction(candidate, null, true);
  assert.equal(result.safe.stops[1].addressLine, '488 PARRIOTT PLACE');
  assert.equal(result.safe.delivery.addressLine, '488 PARRIOTT PLACE');
  assert.equal(result.safe.delivery.appointmentReference, '1222MS925');
  assert.equal(result.documentDetails.fields.find(field => field.key === 'stops.1.addressLine').value,
    '488 PARRIOTT PLACE');
});

test('extended facts preserve printed dates, dimensions, BOL and blank appointment time', () => {
  const { candidate, audit } = fixture();
  for (const [key, value] of Object.entries({ 'pickup.scheduledDate': 'Thu 10/01/2026', 'delivery.scheduledDate': 'Mon 10/05/2026',
    'delivery.note': 'Any day, anytime, just give notice.', cargoModel: 'Generator model X', lengthPrinted: '6 ft 0 in',
    widthPrinted: '4 ft 2 in', heightPrinted: '2 ft 7 in', bolNumber: '25008654', loadedMiles: 0 })) addField(candidate, audit, key, value);
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.pickup.scheduledDate, 'Thu 10/01/2026');
  assert.equal(result.safe.pickup.appointmentFrom, null);
  assert.equal(result.safe.pickup.timePrinted, null);
  assert.equal(result.safe.delivery.referenceNumber, null);
  assert.equal(result.safe.equipmentType, null);
  assert.equal(result.safe.loadedMiles, 0);
  assert.ok(result.driverBrief.fields.some(f => f.key === 'lengthPrinted'));
});

test('payment, legal terms and document-driver identity persist only in staff snapshot', () => {
  const { candidate, audit } = fixture();
  candidate.contractTerms = [];
  audit.documentDetailsComplete = true;
  for (const [key, value] of Object.entries({ paymentTerms: 'Net 30 after all documents', billingEmail: 'billing@example.com',
    documentDriverName: 'Document Driver', documentDriverPhone: '(313) 929-0101', cargoValuePrinted: '$100,000',
    'contractTerms.0': 'Original legal clause, including conditions.' })) addField(candidate, audit, key, value, 7);
  const result = verifyLoadExtraction(candidate, audit);
  assert.deepEqual(result.review.blockingFields, []);
  for (const key of ['paymentTerms', 'billingEmail', 'documentDriverName', 'documentDriverPhone', 'cargoValuePrinted', 'contractTerms.0']) {
    assert.ok(result.documentDetails.fields.some(f => f.key === key && f.page === 7));
    assert.ok(!result.driverBrief.fields.some(f => f.key === key));
  }
  assert.equal(result.safe.brokerRate, null);
  audit.documentDetailsComplete = false;
  assert.ok(verifyLoadExtraction(candidate, audit).review.warningFields.includes('documentDetails'));
});

test('unsupported extended fields and invalid document-driver phones fail closed', () => {
  const { candidate, audit } = fixture();
  addField(candidate, audit, 'documentDriverPhone', 'CONTACT/ADDRESS');
  addField(candidate, audit, 'billingEmail', 'wrong@example.com');
  audit.fields.find(f => f.field === 'billingEmail').verdict = 'uncertain';
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.billingEmail, null);
  assert.equal(result.safe.documentDriverPhone, null);
  assert.ok(result.review.warningFields.includes('billingEmail'));
  assert.deepEqual(result.review.blockingFields, []);
});

test('a positive completeness flag cannot override explicit omitted document clauses', () => {
  const { candidate, audit } = fixture();
  candidate.contractTerms = [];
  audit.documentDetailsComplete = true;
  audit.missingDocumentDetails = [{ page: 7, quote: 'Required payment documents must be submitted within 24 hours.' }];
  assert.ok(verifyLoadExtraction(candidate, audit).review.warningFields.includes('documentDetails'));
});

test('BOL evidence cannot become a stop reference even when the audit accepts it', () => {
  for (const stop of ['pickup', 'delivery']) {
    const { candidate, audit } = fixture();
    addField(candidate, audit, `${stop}.referenceNumber`, '25008654', 2);
    candidate.evidence.find(f => f.field === `${stop}.referenceNumber`).quote = 'BOL #: 25008654';
    audit.fields.find(f => f.field === `${stop}.referenceNumber`).quote = 'BOL #: 25008654';
    const result = verifyLoadExtraction(candidate, audit);
    assert.equal(result.safe[stop].referenceNumber, null);
    assert.ok(result.review.blockingFields.includes(`${stop}.referenceNumber`));
  }
});

test('an explicitly dual-labelled delivery and BOL reference remains supported', () => {
  const { candidate, audit } = fixture();
  addField(candidate, audit, 'delivery.referenceNumber', '25008654', 2);
  const quote = 'Delivery #: 25008654; BOL #: 25008654';
  candidate.evidence.find(f => f.field === 'delivery.referenceNumber').quote = quote;
  audit.fields.find(f => f.field === 'delivery.referenceNumber').quote = quote;
  assert.equal(verifyLoadExtraction(candidate, audit).safe.delivery.referenceNumber, '25008654');
});

test('blank or different delivery labels cannot launder a BOL-only identifier', () => {
  for (const quote of ['Delivery #:\nBOL #: 25008654', 'Delivery #: OTHER; BOL #: 25008654']) {
    const { candidate, audit } = fixture();
    addField(candidate, audit, 'delivery.referenceNumber', '25008654', 2);
    candidate.evidence.find(f => f.field === 'delivery.referenceNumber').quote = quote;
    audit.fields.find(f => f.field === 'delivery.referenceNumber').quote = quote;
    assert.equal(verifyLoadExtraction(candidate, audit).safe.delivery.referenceNumber, null);
  }
});

test('a positive operational completeness flag cannot hide an explicitly missing requirement', () => {
  const { candidate, audit } = fixture();
  audit.operationalRequirementsComplete = true;
  audit.missingOperationalDetails = [{ page: 3, quote: 'Carrier must carry ramps when assistance is unavailable.' }];
  assert.ok(verifyLoadExtraction(candidate, audit).review.blockingFields.includes('requirements'));
});

test('keeps negative temperatures, zero and false without treating them as missing', () => {
  const { candidate, audit } = fixture();
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.temperatureFahrenheit, -10);
  assert.equal(result.safe.palletCount, 0);
  assert.equal(result.safe.isHazmat, false);
  assert.deepEqual(result.review.blockingFields, []);
  assert.equal(result.safe.brokerRate, null);
  assert.equal(result.safe.pickup.appointmentTimezone, null);
  assert.ok(result.driverBrief.unknownFields.includes('brokerRate'));
});
test('unsupported data never enters the driver sheet and blocks dispatch', () => {
  const { candidate, audit } = fixture();
  audit.fields.find(item => item.field === 'pickup.addressLine').verdict = 'contradicted';
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.pickup.addressLine, null);
  assert.ok(result.review.blockingFields.includes('pickup.addressLine'));
  assert.ok(!result.driverBrief.fields.some(item => item.key === 'pickup.addressLine'));
});
test('a zero cargo weight is rejected instead of violating the load constraint', () => {
  const { candidate, audit } = fixture();
  candidate.weightLbs = 0;
  const evidence = { field: 'weightLbs', page: 1, quote: 'Weight: 0 lb' };
  candidate.evidence.push(evidence);
  audit.fields.push({ ...evidence, verdict: 'supported' });
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.weightLbs, null);
  assert.ok(result.review.blockingFields.includes('weightLbs'));
});
test('missing, duplicate and invalid source evidence fail closed', () => {
  for (const mutate of [
    f => { f.candidate.evidence = []; },
    f => { f.audit.fields.push(f.audit.fields[0]); },
    f => { f.audit.fields[0].page = 0; },
    f => { f.audit.fields[0].quote = ''; },
    f => { f.audit.fields[0].page = 2; f.audit.fields[0].quote = 'different unsupported context'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.ok(verifyLoadExtraction(f.candidate, f.audit).review.blockingFields.includes('loadNumber'));
  }
});
test('unreadable, multiple-load and multi-stop documents cannot silently lose stops', () => {
  for (const override of [{ documentReadable: false }, { singleLoad: false }, { pickupCount: 2 }]) {
    const { candidate, audit } = fixture();
    assert.throws(() => verifyLoadExtraction(candidate, { ...audit, ...override }));
  }
});
test('omitted instructions and missing reefer temperature block dispatch', () => {
  const { candidate, audit } = fixture();
  audit.operationalRequirementsComplete = false;
  candidate.equipmentType = 'Reefer'; candidate.temperatureFahrenheit = null;
  const evidence = { field: 'equipmentType', page: 1, quote: 'Equipment: Reefer' };
  candidate.evidence.push(evidence); audit.fields.push({ ...evidence, verdict: 'supported' });
  const result = verifyLoadExtraction(candidate, audit);
  assert.ok(result.review.blockingFields.includes('requirements'));
  assert.ok(result.review.blockingFields.includes('temperatureFahrenheit'));
});
test('bracket and dot requirement paths refer to the same verified instruction', () => {
  const { candidate, audit } = fixture();
  for (const item of [...candidate.evidence, ...audit.fields]) item.field = item.field.replace('requirements.0', 'requirements[0]');
  const result = verifyLoadExtraction(candidate, audit);
  assert.deepEqual(result.safe.requirements, ['Keep seal intact.']);
  assert.deepEqual(result.review.blockingFields, []);
});
test('semantic checks reject address blobs as phones and Appt # as a time', () => {
  const { candidate, audit } = fixture();
  candidate.pickup.contactPhone = '/NCFISPHO1023BUFFAMISSOURICTX77489CONTACT';
  candidate.pickup.appointmentFrom = '2026-09-25T08:00:00';
  for (const [field, quote] of [['pickup.contactPhone', candidate.pickup.contactPhone], ['pickup.appointmentFrom', 'Ready: 09-25-2026 Appt # 0800-1500']]) {
    candidate.evidence.push({ field, quote, page: 1 });
    audit.fields.push({ field, quote, page: 1, verdict: 'supported' });
  }
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.pickup.contactPhone, null);
  assert.equal(result.safe.pickup.appointmentFrom, null);
});
test('weight with unknown units is preserved as printed but cannot be labelled pounds', () => {
  const { candidate, audit } = fixture();
  candidate.weightLbs = 19780; candidate.weightPrinted = '19780.00';
  for (const field of ['weightLbs', 'weightPrinted']) {
    const evidence = { field, page: 1, quote: 'WEIGHT 19780.00' };
    candidate.evidence.push(evidence); audit.fields.push({ ...evidence, verdict: 'supported' });
  }
  const result = verifyLoadExtraction(candidate, audit);
  assert.equal(result.safe.weightLbs, null);
  assert.equal(result.safe.weightPrinted, '19780.00');
});
test('auditor contradiction is resolved only for exact verified text on the same page', () => {
  const { candidate, audit } = fixture();
  audit.operationalRequirementsComplete = false;
  audit.missingOperationalDetails = [{ page: 1, quote: 'Keep seal intact.' }];
  assert.ok(!verifyLoadExtraction(candidate, audit).review.blockingFields.includes('requirements'));
  for (const item of [{ page: 2, quote: 'Keep seal intact.' }, { page: 1, quote: 'Keep seal intact. $100 fine.' }, { page: 1, quote: '' }]) {
    audit.missingOperationalDetails = [item];
    assert.ok(verifyLoadExtraction(candidate, audit).review.blockingFields.includes('requirements'));
  }
});
test('repeated literal document labels may cite different pages, with auditor page retained', () => {
  const { candidate, audit } = fixture();
  audit.fields[0].page = 2;
  assert.equal(verifyLoadExtraction(candidate, audit).driverBrief.fields.find(f => f.key === 'loadNumber').page, 2);
});
test('corrupted Phone/Contact export labels are not actionable missing instructions', () => {
  const { candidate, audit } = fixture();
  audit.operationalRequirementsComplete = false;
  audit.missingOperationalDetails = [{ page: 1, quote: 'Phone/Contact: /NCFISPHO1023BUFFAMISSOURICTX77489CONTACT' }];
  assert.ok(!verifyLoadExtraction(candidate, audit).review.blockingFields.includes('requirements'));
  audit.missingOperationalDetails.push({ page: 2, quote: 'Call before arrival' });
  assert.ok(verifyLoadExtraction(candidate, audit).review.blockingFields.includes('requirements'));
});
