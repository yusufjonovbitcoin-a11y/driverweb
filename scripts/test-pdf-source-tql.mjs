// Offline regression with the user's original file. No AI, DB write or dispatch.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { validatePdfSource, storedPdfSource, evidenceFromSource } from '../supabase/functions/_shared/pdf-source.ts';
import { repairSourceMappings } from '../supabase/functions/_shared/load-source-repair.ts';
import { verifyLoadExtraction } from '../supabase/functions/_shared/load-extraction-verification.ts';
const path = process.argv[2];
if (!path) throw Error('Supply the original Carrier Rate confirmation PDF path');
const result = spawnSync(process.env.PDF_PYTHON || '.venv/pdf/bin/python', ['scripts/pdf_preprocessor.py'], {
  input: fs.readFileSync(path), maxBuffer: 30*1024*1024, timeout: 65000,
  env: {...process.env, TESSDATA_PREFIX: process.env.TESSDATA_PREFIX || `${process.cwd()}/.venv/pdf/tessdata`},
});
if (result.status !== 0) throw Error(result.stderr?.toString() || String(result.error));
const source = JSON.parse(result.stdout); validatePdfSource(source, source.checksum);
assert.equal(source.checksum, '362159be5410075e7ae16ce14adc4fa0fc1d9adfe0626b119f7fa91eced89a86');
const fact = (field, value, printed) => {
  const b = source.pages[0].blocks.find(b => b.text === printed);
  assert.ok(b, `Missing original source: ${printed}`);
  return {field, value, evidence: evidenceFromSource([b.id], source, field)};
};
// Reproduce the production failure: correct values bound to the wrong column.
const candidate = { loadNumber:null, broker:{name:'Total Quality Logistics',fax:'0'}, palletCount:12,caseCount:0,
  isHazmat:true,weightLbs:26544,weightPrinted:'26544',brokerRate:4900,requirements:[],contractTerms:[],
  pickupCount:1,deliveryCount:1,
  stops:[{role:'pickup',addressLine:'Flanders, NJ',city:'Flanders',region:'NJ'},
    {role:'delivery',addressLine:'Houston, TX',city:'Houston',region:'TX'}],
  documentReview:{documentReadable:true,singleLoad:true,allPagesRead:true,pageCount:source.pageCount,
    operationalRequirementsComplete:true,documentDetailsComplete:true,uncertainFields:[]},
  sourceManifest:storedPdfSource(source),evidence:[] };
candidate.evidence = [fact('palletCount',12,'Hazardous'),fact('caseCount',0,'Hazardous'),
  fact('broker.fax','0','0'),fact('weightLbs',26544,'26544'),fact('weightPrinted','26544','26544'),
  fact('brokerRate',4900,'Total: $4,900.00 USD'),
  ...candidate.stops.flatMap((s,i)=>['addressLine','city','region'].map(k=>fact(`stops.${i}.${k}`,s[k],s.addressLine)))].map(f=>f.evidence);
const repaired = repairSourceMappings(candidate,source);
const {safe,review} = verifyLoadExtraction(repaired,null,true);
assert.equal(safe.loadNumber,'38594033'); assert.equal(safe.brokerRate,4900);
assert.equal(safe.palletCount,12); assert.equal(safe.caseCount,0); assert.equal(safe.isHazmat,true);
assert.equal(safe.broker.name,'TQL'); assert.equal(safe.broker.fax,null);
assert.equal(safe.billingEmail,'CINVOICES@TQL.COM');
assert.equal(safe.documentDeadline,'WITHIN 24 HOURS OF DELIVERY');
assert.ok(safe.requiredDocuments.includes('COMPLETE BOL(S)/POD, RECEIPTS'));
assert.equal(safe.weightLbs,null); assert.equal(safe.weightPrinted,'26544');
assert.equal(safe.stops[0].city,'Flanders'); assert.equal(safe.stops[1].city,'Houston');
assert.equal(safe.stops[0].addressLine,null); assert.equal(safe.stops[1].addressLine,null);
assert.ok(review.blockingFields.includes('pickup.addressLine'));
const listCandidate = structuredClone(candidate);
listCandidate.requirements = ['Driver(s) must be on the dock during loading to count and inspect the freight. Any discrepancy or damage must be reported to TQL immediately. Contact TQL immediately if not allowed on the dock.'];
assert.equal(verifyLoadExtraction(repairSourceMappings(listCandidate,source),null,true).safe.requirements.length,1);
console.log(JSON.stringify({passed:true,kind:'offline-original-PDF-regression',pages:source.pageCount,
  repairedFields:repaired.sourceRepairs.map(r=>r.field),modelCalls:0,remainingBlockers:review.blockingFields}));
