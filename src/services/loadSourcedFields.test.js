import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcedExtractionSchema, decodeSourcedExtraction } from '../../supabase/functions/_shared/load-sourced-fields.ts';
import { singlePassValueSupported, sourcePrintedDate } from '../../supabase/functions/_shared/load-single-pass.ts';
import { verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';
import { correctExtraction } from '../../supabase/functions/_shared/load-corrections.ts';
import { buildImportedLoad } from '../components/importedLoadModel.js';
import { previewLoadRoute } from '../../supabase/functions/_shared/google-load-route.ts';

const fact = (value, quote=String(value), page=1) => ({value,quote,page});
function sample() {
  return {loadNumber:fact('25008654','LOAD NO: #25008654'),brokerRate:fact(1000,'Total: $1,000.00'),loadedMiles:fact(0,'Miles: 0.0'),
    requirements:[fact('Send loaded photos.')],contractTerms:[],
    documentReview:{documentReadable:true,singleLoad:true,allPagesRead:true,pageCount:8,operationalRequirementsComplete:true,documentDetailsComplete:true,uncertainFields:[]},
    stops:[{role:'pickup',addressLine:fact('25 Gill Ave'),city:fact('Rockaway'),region:fact('NJ'),scheduledDate:fact('2026-10-01','Date: Thu, 10/01/2026'),hours:fact('7:00am-3:30pm M-F')},
      {role:'delivery',addressLine:fact('7027 W Brightwater Way'),city:fact('Tucson'),region:fact('AZ'),scheduledDate:fact('2026-10-05','Date: Mon, 10/05/2026'),timingNote:fact('Any day, anytime, just give notice.')}],
  };
}
test('source-bound facts preserve the reported load number, price, zero miles and US dates',()=>{
  const result=verifyLoadExtraction(decodeSourcedExtraction(sample()),null,true);
  assert.deepEqual(result.review.blockingFields,[]);
  const page=buildImportedLoad({documentDetails:result.documentDetails,review:result.review});
  assert.equal(page.number,'25008654'); assert.equal(page.rate,1000); assert.equal(page.distance,0); assert.equal(page.rpm,null);
  assert.equal(page.stops[0].scheduledDate,'2026-10-01'); assert.equal(page.stops[0].hours,'7:00am-3:30pm M-F');
  assert.equal(page.stops[1].timingNote,'Any day, anytime, just give notice.'); assert.equal(page.stops[1].reference,null);
});
test('all stops preserve order, separate evidence, uncertainty and fields',()=>{
  const wire=sample(); wire.stops.splice(1,0,{role:'delivery',addressLine:fact('2 Main St'),city:fact('Dallas'),region:fact('TX')});
  const candidate=decodeSourcedExtraction(wire); const result=verifyLoadExtraction(candidate,null,true);
  assert.deepEqual(result.review.blockingFields,['multiStopDriverWorkflow']); assert.equal(result.safe.stops.length,3);
  assert.equal(result.safe.delivery.city,'Tucson'); assert.equal(result.safe.stops[1].city,'Dallas');
  candidate.documentReview.uncertainFields=['stops.2.city'];
  const uncertain=verifyLoadExtraction(candidate,null,true);
  assert.equal(uncertain.safe.delivery.city,null); assert.equal(uncertain.safe.stops[2].city,null);
  assert.ok(uncertain.review.blockingFields.includes('stops.2.city'));
});
test('date comparisons reject wrong or impossible dates without fabricating time',()=>{
  assert.equal(sourcePrintedDate('stops.0.scheduledDate','2026-09-22','Pickup Dates 9/22/26'),'9/22/26');
  assert.equal(sourcePrintedDate('stops.0.scheduledDate','2026-09-23','Pickup Dates 9/22/26'),'2026-09-23');
  for(const path of ['pickup.scheduledDate','stops.2.scheduledDate','delivery.readyDate']) {
    assert.equal(singlePassValueSupported(path,'2026-10-01','Date 10/01/2026'),true);
    assert.equal(singlePassValueSupported(path,'2026-10-02','Date 10/01/2026'),false);
    assert.equal(singlePassValueSupported(path,'2026-02-30','Date 02/30/2026'),false);
  }
});
test('every scalar source is structurally mandatory, unknown values remain nullable',()=>{
  const schema=sourcedExtractionSchema({properties:{loadNumber:{type:['string','null']},pickup:{},delivery:{},evidence:{},documentReview:{type:'object'}}},{properties:{addressLine:{type:['string','null']}}});
  assert.deepEqual(schema.properties.loadNumber.required,['value','page','quote']);
  assert.equal(schema.properties.stops.items.properties.addressLine.properties.page.type[1],'null');
  assert.ok(!schema.properties.evidence); assert.ok(!schema.properties.pickup);
});
test('verbatim clauses carry their page without duplicating long text in the model output',()=>{
  const wire=sample();
  wire.contractTerms=[{value:'Broker pays Net 30 after all required documents are received.',page:7}];
  const candidate=decodeSourcedExtraction(wire);
  assert.equal(candidate.evidence.find(e=>e.field==='contractTerms.0').quote,wire.contractTerms[0].value);
  assert.equal(verifyLoadExtraction(candidate,null,true).safe.contractTerms[0],wire.contractTerms[0].value);
});
test('short printed years survive full validation without inventing a century',()=>{
  const wire=sample();
  wire.stops[0].scheduledDate=fact('2026-09-22','Pickup Dates 9/22/26');
  const verified=verifyLoadExtraction(decodeSourcedExtraction(wire),null,true);
  assert.equal(verified.safe.stops[0].scheduledDate,'9/22/26');
  assert.deepEqual(verified.review.blockingFields,[]);
});
test('human corrections are auditable, scoped and still pass semantic rules',()=>{
  const original=decodeSourcedExtraction(sample());
  const edited=correctExtraction(original,[{field:'loadNumber',value:'TEST',page:1,quote:'Load TEST'}],'actor');
  assert.equal(original.loadNumber,'25008654'); assert.equal(edited.corrections[0].actorId,'actor');
  assert.equal(verifyLoadExtraction(edited,null,true).safe.loadNumber,'TEST');
  for(const field of ['__proto__.x','stops.9.city','stops.0.role','pickup.city'])
    assert.throws(()=>correctExtraction(original,[{field,value:'bad',page:1,quote:'bad'}],'actor'));
  assert.throws(()=>correctExtraction(original,[{field:'brokerRate',value:'abc',page:1,quote:'abc'}],'actor'));
});
test('multi-stop road route sums every leg and never invents driver GPS',async()=>{
  let legs=0;
  const fetcher=async(url)=> url.includes('/geocode/') ? Response.json({features:[{geometry:{type:'Point',coordinates:[-100,35]},properties:{feature_type:'address',match_code:{confidence:'exact',street:'matched',place:'matched'},context:{address:{address_number:'1'},region:{region_code:'TX'},country:{country_code:'US'}}}}]})
    : (++legs,Response.json({code:'Ok',routes:[{distance:1609.344,duration:60,geometry:'_p~iF~ps|U_ulLnnqC_mqNvxq`@'}]}));
  const stops=['pickup','delivery','delivery'].map(type=>({type,address_line:'1 Main St',city:'Test',region:'TX'}));
  const result=await previewLoadRoute(stops,[],['driver'],'',fetcher,Date.now(),'token','mapbox');
  assert.equal(legs,2); assert.equal(result.loadedMiles,2); assert.equal(result.durationSeconds,120);
  assert.equal(result.stops.length,3); assert.equal(result.targets[0].totalMiles,null);
});
