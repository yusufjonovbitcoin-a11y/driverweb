// No model call, database writes or driver dispatch. Tests an actual user's PDF
// against explicitly curated expectations, through preprocessing + rules + UI model.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { validatePdfSource } from '../supabase/functions/_shared/pdf-source.ts';
import { decodeSourcedExtraction } from '../supabase/functions/_shared/load-sourced-fields.ts';
import { verifyLoadExtraction } from '../supabase/functions/_shared/load-extraction-verification.ts';
import { buildImportedLoad } from '../src/components/importedLoadModel.js';

const path=process.argv[2];
if(!path) throw Error('Usage: PDF_PYTHON=python3 node scripts/test-pdf-source-original.mjs /path/to/CarrierConfirmation.pdf');
const start=performance.now();
const result=spawnSync(process.env.PDF_PYTHON||'python3',['scripts/pdf_preprocessor.py'],{
  input:fs.readFileSync(path),maxBuffer:30*1024*1024,timeout:65000});
if(result.status!==0) throw Error(result.stderr?.toString()||String(result.error));
const source=JSON.parse(result.stdout); validatePdfSource(source,source.checksum);
assert.equal(source.pageCount,8);
const fact=(value,page,...texts)=>({value,source_ids:texts.map(text=>{
  const b=source.pages[page-1].blocks.find(b=>b.text===text); assert.ok(b,`Missing source: ${text}`); return b.id;
})});
const wire={loadNumber:fact('25008654',1,'LOAD NO: #25008654'),brokerRate:fact(1000,1,'Total:','$1,000.00'),
  weightLbs:fact(1800,1,'Total Weight: 1,800 lbs'),loadedMiles:fact(0,1,'MILES: 0.0'),requirements:[],contractTerms:[],
  documentReview:{documentReadable:true,singleLoad:true,allPagesRead:true,pageCount:8,operationalRequirementsComplete:true,documentDetailsComplete:true,uncertainFields:[]},
  stops:[{role:'pickup',addressLine:fact('25 Gill Ave',1,'25 Gill Ave'),city:fact('Rockaway',1,'Rockaway, NJ 07866'),region:fact('NJ',1,'Rockaway, NJ 07866'),
    scheduledDate:fact('2026-10-01',1,'Date: Thu, 10/01/2026'),hours:fact('7:00am-3:30pm M-F',1,'7:00am-3:30pm M-F')},
    {role:'delivery',addressLine:fact('7027 W Brightwater Way',2,'7027 W Brightwater Way'),city:fact('Tucson',2,'Tucson, AZ 85757'),region:fact('AZ',2,'Tucson, AZ 85757'),
      scheduledDate:fact('2026-10-05',2,'Date: Mon, 10/05/2026'),timingNote:fact('Any day, anytime, just give notice.',2,'Any day, anytime, just give notice.')}]
};
const verified=verifyLoadExtraction(decodeSourcedExtraction(wire,source),null,true);
assert.deepEqual(verified.review.blockingFields,[]);
const page=buildImportedLoad({documentDetails:verified.documentDetails,review:verified.review});
assert.equal(page.number,'25008654'); assert.equal(page.rate,1000); assert.equal(page.distance,0); assert.equal(page.rpm,null);
assert.equal(page.stops[0].scheduledDate,'2026-10-01'); assert.equal(page.stops[1].scheduledDate,'2026-10-05');
assert.equal(page.stops[0].reference,null); assert.equal(page.stops[1].reference,null);
console.log(JSON.stringify({passed:true,kind:'offline-curated-source-test-not-live-AI',pages:source.pageCount,
  blocks:source.pages.reduce((n,p)=>n+p.blocks.length,0),elapsedMs:Math.round(performance.now()-start),
  modelCalls:0,loadNumber:page.number,rate:page.rate,weightLbs:verified.safe.weightLbs,
  dates:page.stops.map(s=>s.scheduledDate),refs:page.stops.map(s=>s.reference)}));
