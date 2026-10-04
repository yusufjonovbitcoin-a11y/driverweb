import test from 'node:test';
import assert from 'node:assert/strict';
import { repairSourceMappings } from '../../supabase/functions/_shared/load-source-repair.ts';
import { singlePassValueSupported } from '../../supabase/functions/_shared/load-single-pass.ts';
import { verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';

function fixture(texts) {
  const source = { version: 1, checksum: 'a'.repeat(64), engine: 'test', pageCount: 1,
    pages: [{ number: 1, width: 600, height: 800, ocr: false,
      blocks: texts.map((text, i) => ({ id: `page_1_block_${i}_line_0`, text, bbox: [20, 10+i*18, 300, 20+i*18] })) }] };
  const candidate = { loadNumber: null, broker: {name: 'Total Quality Logistics'}, palletCount: 12, caseCount: 0,
    isHazmat: true, evidence: [], requirements: [], contractTerms: [], pickupCount: 1, deliveryCount: 1,
    stops: [{role:'pickup',city:'Flanders',region:'NJ',addressLine:'Flanders, NJ'},
      {role:'delivery',city:'Houston',region:'TX',addressLine:'Houston, TX'}], sourceManifest: source,
    documentReview: { documentReadable:true,singleLoad:true,allPagesRead:true,pageCount:1,
      operationalRequirementsComplete:true,documentDetailsComplete:true,uncertainFields:[] } };
  return {source,candidate};
}
test('repairs labelled PO, count cell and hazardous column with real line IDs', () => {
  const {source,candidate} = fixture(['TQL RATE CONFIRMATION FOR PO# 38594033','12 pallets/0 cases','Hazmat','Hazardous']);
  const repaired = repairSourceMappings(candidate,source);
  const r = verifyLoadExtraction(repaired,null,true);
  assert.equal(r.safe.loadNumber,'38594033'); assert.equal(r.safe.broker.name,'TQL');
  assert.equal(r.safe.palletCount,12); assert.equal(r.safe.caseCount,0); assert.equal(r.safe.isHazmat,true);
  assert.equal(candidate.loadNumber,null); // input is untouched
  assert.ok(r.review.blockingFields.includes('pickup.addressLine'));
});
test('conflicting explicit numbers stay uncertain, BOL and generic PO never become load ID', () => {
  for (const texts of [['BOL# 1234','PO# 7777'],['LOAD NO: 1234','LOAD NO: 5678']]) {
    const {source,candidate} = fixture(texts);
    const repaired = repairSourceMappings(candidate,source);
    assert.equal(repaired.loadNumber,null);
    if(texts.length && texts[0].startsWith('LOAD')) assert.ok(repaired.documentReview.uncertainFields.includes('loadNumber'));
  }
});
test('Hazardous prose or neighbouring column does not establish HAZMAT', () => {
  assert.equal(singlePassValueSupported('isHazmat',true,'Hazardous'),false);
  assert.equal(singlePassValueSupported('isHazmat',true,'If hazmat: hazardous cargo requires paperwork'),false);
  for (const text of ['If hazardous, provide a placard.','non-hazardous']) {
    const {source,candidate} = fixture(['Hazmat',text]);
    source.pages[0].blocks[1].bbox[0] = 350;
    const r = repairSourceMappings(candidate,source);
    assert.equal(r.evidence.some(e=>e.field==='isHazmat'),false);
  }
  const {source,candidate}=fixture(['Hazmat','Non-hazardous']);
  assert.equal(verifyLoadExtraction(repairSourceMappings(candidate,source),null,true).safe.isHazmat,false);
});
test('exact clause continuation may be rebound; altered numbers/qualifiers cannot', () => {
  const {source,candidate}=fixture(['Photos must be sent before departure.','Wait for approval before leaving.']);
  candidate.requirements=['Photos must be sent before departure. Wait for approval before leaving.'];
  let r=repairSourceMappings(candidate,source);
  assert.equal(r.evidence[0].sourceIds.length,2);
  candidate.requirements=['Photos must be sent after departure. Wait for approval before leaving.'];
  r=repairSourceMappings(candidate,source);
  assert.equal(r.evidence.length,0);
});
test('matching digits in the wrong column do not take precedence over the count cell',()=>{
  const {source,candidate}=fixture(['Rate $12','12 pallets/0 cases']);
  candidate.evidence=[{field:'palletCount',quote:'Rate $12',sourceIds:[source.pages[0].blocks[0].id]}];
  const r=repairSourceMappings(candidate,source);
  assert.equal(r.evidence.find(e=>e.field==='palletCount').quote,'12 pallets/0 cases');
});
test('list markers do not hide an exact multi-line instruction; qualifiers still must match',()=>{
  const {source,candidate}=fixture(['Driver must inspect freight.','◦','Report damage immediately.','◦','Call before leaving.']);
  candidate.requirements=['Driver must inspect freight. Report damage immediately. Call before leaving.'];
  const r=repairSourceMappings(candidate,source);
  assert.equal(verifyLoadExtraction(r,null,true).safe.requirements.length,1);
  assert.equal(r.evidence[0].sourceIds.length,3);
  candidate.requirements=['Driver must inspect freight. Report damage immediately. Call after leaving.'];
  assert.equal(repairSourceMappings(candidate,source).evidence.length,0);
});
test('city-only source is not a complete address and unitless weight remains unverified',()=>{
  const {source,candidate}=fixture(['Flanders, NJ','Houston, TX','26544']);
  candidate.weightLbs=26544;
  candidate.evidence=[...candidate.stops.flatMap((s,i)=>['addressLine','city','region'].map(key=>({field:`stops.${i}.${key}`,sourceIds:[source.pages[0].blocks[i].id]}))),
    {field:'weightLbs',sourceIds:[source.pages[0].blocks[2].id]}];
  const r=verifyLoadExtraction(candidate,null,true);
  assert.equal(r.safe.stops[0].addressLine,null); assert.equal(r.safe.stops[0].city,'Flanders');
  assert.equal(r.safe.weightLbs,null);
});
test('payment submission lines fill only explicit billing fields, preserving normal terms',()=>{
  const {source,candidate}=fixture(['TO ENSURE PAYMENT, SUBMIT RATE CONFIRMATION, BOL(S)/POD, RECEIPTS',
    'AND OTHER PAPERWORK WITHIN 24 HOURS OF DELIVERY TO INVOICES@BROKER.COM.']);
  source.pages[0].blocks[1].id='page_1_block_0_line_1';
  candidate.paymentTerms='28DAYS';
  const r=repairSourceMappings(candidate,source);
  assert.equal(r.billingEmail,'INVOICES@BROKER.COM');
  assert.equal(r.documentDeadline,'WITHIN 24 HOURS OF DELIVERY');
  assert.equal(r.requiredDocuments,'RATE CONFIRMATION, BOL(S)/POD, RECEIPTS AND OTHER PAPERWORK');
  assert.equal(r.paymentTerms,'28DAYS');
  assert.equal(verifyLoadExtraction(r,null,true).safe.billingEmail,'INVOICES@BROKER.COM');
});
