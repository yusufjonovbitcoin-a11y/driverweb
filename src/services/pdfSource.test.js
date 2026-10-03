import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePdfSource, evidenceFromSource, findCorrectionSource, fetchPdfSource, pdfSourceInput } from '../../supabase/functions/_shared/pdf-source.ts';
import { decodeSourcedExtraction, sourcedExtractionSchema } from '../../supabase/functions/_shared/load-sourced-fields.ts';
import { verifyLoadExtraction } from '../../supabase/functions/_shared/load-extraction-verification.ts';
import { correctExtraction } from '../../supabase/functions/_shared/load-corrections.ts';

const block = (n,text) => ({id:`page_1_block_${n}_line_0`,text,bbox:[10,10+n*10,200,20+n*10]});
function fixture() {
  const source={version:1,checksum:'a'.repeat(64),engine:'test',pageCount:1,pages:[{number:1,width:600,height:800,ocr:false,
    image:'data:image/jpeg;base64,/9j/',blocks:[block(0,'Load TEST-42'),block(1,'Pickup 1 First Ave Phoenix AZ'),block(2,'Delivery 2 Second Ave Dallas TX'),block(3,'Rate $1000')]}]};
  const fact=(value,n)=>({value,source_ids:[block(n,'').id]});
  const wire={loadNumber:fact('TEST-42',0),brokerRate:fact(1000,3),requirements:[],contractTerms:[],
    documentReview:{documentReadable:true,singleLoad:true,allPagesRead:true,pageCount:1,operationalRequirementsComplete:true,documentDetailsComplete:true,uncertainFields:[]},
    stops:[{role:'pickup',addressLine:fact('1 First Ave',1),city:fact('Phoenix',1),region:fact('AZ',1)},
      {role:'delivery',addressLine:fact('2 Second Ave',2),city:fact('Dallas',2),region:fact('TX',2)}]};
  return {source,wire};
}
test('grounded schema uses source IDs, never model-authored quotes or pages',()=>{
  const s=sourcedExtractionSchema({properties:{loadNumber:{type:['string','null']}}},{properties:{city:{type:['string','null']}}},true);
  assert.deepEqual(s.properties.loadNumber.required,['value','source_ids']);
  assert.equal(s.properties.loadNumber.properties.quote,undefined);
});
test('real source determines page, quote, bbox and checksum, even when AI supplies forged extras',()=>{
  const {source,wire}=fixture(); wire.loadNumber.quote='Forged'; wire.loadNumber.page=99;
  const candidate=decodeSourcedExtraction(wire,source); const r=verifyLoadExtraction(candidate,null,true);
  assert.deepEqual(r.review.blockingFields,[]); assert.equal(r.review.sourceGrounded,true);
  const field=r.documentDetails.fields.find(f=>f.key==='loadNumber');
  assert.equal(field.quote,'Load TEST-42'); assert.equal(field.page,1); assert.equal(field.sourceChecksum,source.checksum);
  assert.deepEqual(field.sourceBoxes[0].bbox,[10,10,200,20]);
  assert.equal(candidate.sourceManifest.pages[0].image,undefined);
});
test('fake, duplicated, empty and wrong-field sources do not verify a fact',()=>{
  for(const ids of [[],['invented'],[block(0,'').id,block(0,'').id],[block(3,'').id]]) {
    const {source,wire}=fixture(); wire.loadNumber.source_ids=ids;
    const r=verifyLoadExtraction(decodeSourcedExtraction(wire,source),null,true);
    assert.equal(r.safe.loadNumber,null); assert.ok(r.review.blockingFields.includes('loadNumber'));
  }
});
test('cached evidence is rebuilt; changing a quote or its value cannot bypass grounding',()=>{
  const {source,wire}=fixture(); const c=decodeSourcedExtraction(wire,source);
  c.loadNumber='MADE-UP'; c.evidence.find(e=>e.field==='loadNumber').quote='Load MADE-UP';
  assert.equal(verifyLoadExtraction(c,null,true).safe.loadNumber,null);
});
test('BOL and cargo value sources cannot masquerade as load number and freight rate',()=>{
  const {source,wire}=fixture();
  source.pages[0].blocks[0].text='BOL TEST-42';
  source.pages[0].blocks[3].text='Declared cargo value $1000';
  const r=verifyLoadExtraction(decodeSourcedExtraction(wire,source),null,true);
  assert.equal(r.safe.loadNumber,null); assert.equal(r.safe.brokerRate,null);
});
test('checksum, duplicate IDs, missing pages and false page count fail closed',()=>{
  const {source,wire}=fixture(); assert.throws(()=>validatePdfSource(source,'b'.repeat(64)));
  wire.documentReview.pageCount=8; assert.throws(()=>decodeSourcedExtraction(wire,source));
  source.pages[0].blocks.push(source.pages[0].blocks[0]); assert.throws(()=>validatePdfSource(source,source.checksum));
});
test('human correction quote must exist on the stated source page',()=>{
  const {source,wire}=fixture(); const c=decodeSourcedExtraction(wire,source);
  assert.throws(()=>correctExtraction(c,[{field:'loadNumber',value:'INVENTED',page:1,quote:'Load INVENTED'}],'actor'));
  const r=correctExtraction(c,[{field:'loadNumber',value:'TEST-42',page:1,quote:'Load TEST-42'}],'actor');
  assert.equal(verifyLoadExtraction(r,null,true).safe.loadNumber,'TEST-42');
  assert.deepEqual(findCorrectionSource(source,1,'Rate $1000','brokerRate').sourceIds,[block(3,'').id]);
  assert.throws(()=>findCorrectionSource(source,2,'Rate $1000','brokerRate'));
});
test('all pages supply images and positioned text, no original input_file',()=>{
  const {source}=fixture(); const input=pdfSourceInput(source);
  assert.equal(input.filter(i=>i.type==='input_image').length,1);
  assert.equal(input.filter(i=>i.type==='input_file').length,0);
  assert.equal(JSON.parse(input[0].text).blocks[0].id,block(0,'').id);
  assert.equal(evidenceFromSource([block(3,'').id],source,'brokerRate').sourceMethod,'pdf_text');
});
test('server fetch uses configured private endpoint and rejects HTTP, redirects and failed preprocessing',async()=>{
  const {source}=fixture(); let calls=0;
  const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://worker.example/preprocess');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+'x'.repeat(32));return Response.json(source);};
  const result=await fetchPdfSource(new Uint8Array([1]),source.checksum,'https://worker.example/preprocess','x'.repeat(32),fetcher);
  assert.equal(result.pageCount,1); assert.equal(calls,1);
  await assert.rejects(()=>fetchPdfSource(new Uint8Array([1]),source.checksum,'http://worker.example/preprocess','x'.repeat(32),fetcher));
  await assert.rejects(()=>fetchPdfSource(new Uint8Array([1]),source.checksum,'https://worker.example/preprocess','x'.repeat(32),async()=>new Response('',{status:500})));
});
