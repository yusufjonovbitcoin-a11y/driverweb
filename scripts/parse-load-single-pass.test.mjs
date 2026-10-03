import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

// Execute the real Edge handler with isolated fake providers: no credentials,
// network, uploads, database records or paid model calls are used by this test.
const bundle = await rolldown({
  input: new URL('../supabase/functions/parse-load-document/index.ts', import.meta.url).pathname,
  plugins: [{ name: 'fake-supabase', resolveId(id) { if (id.startsWith('https://esm.sh/@supabase/')) return '\0fake-supabase'; },
    load(id) { if (id === '\0fake-supabase') return 'export const createClient = () => globalThis.testClient;'; } }],
});
const { output } = await bundle.generate({ format: 'iife' });
await bundle.close();

function extraction() {
  const value = { loadNumber: 'TEST-42', pickupCount: 1, deliveryCount: 1, requirements: [], contractTerms: [],
    pickup: { addressLine: '1 First Ave', city: 'Phoenix', region: 'AZ' },
    delivery: { addressLine: '2 Second Ave', city: 'Dallas', region: 'TX' },
    documentReview: { documentReadable: true, singleLoad: true, pageCount: 1, allPagesRead: true,
      operationalRequirementsComplete: true, documentDetailsComplete: true, uncertainFields: [] }, evidence: [] };
  value.evidence = [{field:'loadNumber',quote:'Load TEST-42',page:1}, ...['pickup','delivery'].flatMap(stop =>
    Object.entries(value[stop]).map(([key,text]) => ({field:`${stop}.${key}`,quote:text,page:1})))];
  return value;
}
function harness({role='dispatcher', providerStatus='completed', uncertain=false, grounded=false, workerFailed=false}={}) {
  let handler;
  const requests = [];
  const client = { auth: {getUser:async()=>({data:{user:{id:'test-user'}}})},
    rpc: async(name)=>{ assert.equal(name,'consume_edge_rate_limit'); return {data:true}; },
    from(name) { assert.equal(name,'profiles'); return {select(){return this;},eq(){return this;},
      maybeSingle:async()=>({data:{id:'test-user',company_id:'test-company',role,status:'active'}})}; } };
  const environment = {SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',OPENAI_API_KEY:'test'};
  if(grounded) Object.assign(environment,{PDF_PREPROCESSOR_URL:'https://worker.invalid/preprocess',PDF_PREPROCESSOR_TOKEN:'x'.repeat(32)});
  let source;
  vm.runInNewContext(output[0].code, { testClient:client, Deno:{env:{get:name=>environment[name]},serve:fn=>{handler=fn;}},
    console:{info(){},error(){}}, performance, AbortSignal, Response, Request, File, FormData, Headers,
    URL, crypto, TextEncoder, TextDecoder, Uint8Array, btoa, Intl,
    fetch:async(url, options)=>{
      if(url==='https://worker.invalid/preprocess') {
        if(workerFailed) return Response.json({error:'failed'},{status:503});
        const digest=await crypto.subtle.digest('SHA-256',options.body);
        const checksum=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
        source={version:1,checksum,engine:'test',pageCount:1,pages:[{number:1,width:600,height:800,ocr:false,
          image:'data:image/jpeg;base64,/9j/',blocks:extraction().evidence.map((e,i)=>({id:`page_1_block_${i}_line_0`,text:e.quote,bbox:[0,i*10,200,i*10+9]}))}]};
        return Response.json(source);
      }
      assert.equal(url,'https://api.openai.com/v1/responses');
      requests.push(JSON.parse(options.body)); const candidate=extraction();
      if(uncertain) candidate.documentReview.uncertainFields=['loadNumber'];
      let wire=candidate;
      if(grounded) {
        const fact=(value,path)=>({value,source_ids:[source.pages[0].blocks[candidate.evidence.findIndex(e=>e.field===path)].id]});
        wire={loadNumber:fact(candidate.loadNumber,'loadNumber'),requirements:[],contractTerms:[],documentReview:candidate.documentReview,
          stops:['pickup','delivery'].map(role=>({role,...Object.fromEntries(Object.entries(candidate[role]).map(([k,v])=>[k,fact(v,`${role}.${k}`)]))}))};
      }
      return Response.json({status:providerStatus,output:[{content:[{type:'output_text',text:JSON.stringify(wire)}]}]}); },
  });
  return { requests, async run(auth=true) {
    const form = new FormData(); form.set('auditOnly','true'); form.set('file',new File(['%PDF-1.7\nTest'], 'test.pdf',{type:'application/pdf'}));
    return handler(new Request('https://test.invalid/parse-load-document',{method:'POST',headers:auth?{Authorization:'Bearer test'}:{},body:form}));
  }};
}
test('real diagnostic handler sends the document once and checks the returned facts', async()=>{
  const h=harness(); const response=await h.run(); const result=await response.json();
  assert.equal(response.status,200); assert.equal(h.requests.length,1);
  assert.deepEqual(result.verified.review.blockingFields,[]);
  assert.equal(result.verified.review.independentAudit,false);
  assert.equal(h.requests[0].input[0].content.filter(c=>c.type==='input_file').length,1);
  assert.ok(h.requests[0].text.format.schema.required.includes('documentReview'));
});
test('real handler returns blocked results without retry and rejects incomplete model responses', async()=>{
  const warning=harness({uncertain:true}); const result=await (await warning.run()).json();
  assert.deepEqual(result.verified.review.blockingFields,['loadNumber']); assert.equal(warning.requests.length,1);
  const incomplete=harness({providerStatus:'incomplete'});
  assert.equal((await incomplete.run()).status,422); assert.equal(incomplete.requests.length,1);
});
test('authentication and staff authorization still guard PDF analysis', async()=>{
  const anonymous=harness(); assert.equal((await anonymous.run(false)).status,401); assert.equal(anonymous.requests.length,0);
  const driver=harness({role:'driver'}); assert.equal((await driver.run()).status,403); assert.equal(driver.requests.length,0);
});
test('grounded handler sends positioned text and image once, validates sources, never resends PDF to AI',async()=>{
  const h=harness({grounded:true}); const response=await h.run(); const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result)); assert.equal(h.requests.length,1);
  assert.deepEqual(result.verified.review.blockingFields,[]); assert.equal(result.verified.review.sourceGrounded,true);
  const content=h.requests[0].input[0].content;
  assert.equal(content.filter(c=>c.type==='input_file').length,0);
  assert.equal(content.filter(c=>c.type==='input_image').length,1);
  assert.ok(JSON.parse(content[0].text).blocks[0].bbox);
  assert.equal(result.audit.method,'pdf_source_rules');
});
test('worker failure stops before AI without silently downgrading to ungrounded PDF mode',async()=>{
  const h=harness({grounded:true,workerFailed:true}); const response=await h.run();
  assert.equal(response.status,422); assert.equal(h.requests.length,0);
});
