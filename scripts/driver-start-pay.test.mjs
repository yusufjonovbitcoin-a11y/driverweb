import assert from 'node:assert/strict';
import test from 'node:test';
import { isDriverPayWorker, processDriverStartPay } from '../supabase/functions/_shared/driver-start-pay.ts';
import { calculateStartDriverPayRoute, DriverPayRouteError, validateDriverPayStops } from '../supabase/functions/_shared/google-load-route.ts';

const lease={jobId:'job',assignmentId:'assignment',driverId:'driver',
  origin:{latitude:40,longitude:-74,capturedAt:'2026-01-01T00:00:00Z'},
  stops:[{id:'s1',type:'pickup'},{id:'s2',type:'delivery'}]};
function fixture(data=lease) {
  const calls=[];
  return {calls,client:{async rpc(name,args){calls.push({name,args});
    return {data:name==='claim_driver_pay_calculation'?data:true};}}};
}
test('worker credential is dedicated, exact and never accepts missing/malformed tokens',()=>{
  const token='ab'.repeat(32);
  const request=value=>new Request('https://example.invalid',{headers:{'X-Worker-Token':value}});
  assert.equal(isDriverPayWorker(request(token),token),true);
  for(const supplied of ['',token+'a',token.slice(1),'cb'+token.slice(2)])
    assert.equal(isDriverPayWorker(request(supplied),token),false);
  assert.equal(isDriverPayWorker(request('secret'),'secret'),false);
  assert.equal(isDriverPayWorker(request(token),undefined),false);
});
test('server uses persisted START origin and ordered stop snapshot, never later presence/client prices',async()=>{
  const f=fixture();
  const result=await processDriverStartPay(f.client,'worker','assignment',()=>'',async(stops,origin)=>{
    assert.deepEqual(origin,lease.origin); assert.equal(origin.capturedAt,'2026-01-01T00:00:00Z');
    assert.deepEqual(stops,lease.stops);
    return {loadedMiles:100.25,deadheadMiles:20.5,provider:'mapbox'};
  });
  assert.deepEqual(result,{claimed:1,completed:1,failed:0});
  assert.deepEqual(f.calls[1].args,{p_job_id:'job',p_worker_id:'worker',p_loaded_miles:100.25,
    p_deadhead_miles:20.5,p_provider:'mapbox',p_failed:false,p_error_code:null});
});
test('empty queue does not route and provider failure retries without fake zero values or leaked URLs',async()=>{
  const empty=fixture(null);
  assert.deepEqual(await processDriverStartPay(empty.client,'worker',null,()=>'',()=>assert.fail()),
    {claimed:0,completed:0,failed:0});
  for(const calculate of [async()=>{throw Error('https://provider.invalid?access_token=SECRET');},
    async()=>({loadedMiles:NaN,deadheadMiles:0,provider:'mapbox'}),
    async()=>({loadedMiles:100,deadheadMiles:-1,provider:'mapbox'})]) {
    const f=fixture();
    assert.deepEqual(await processDriverStartPay(f.client,'worker',null,()=>'',calculate),{claimed:1,completed:0,failed:1});
    assert.deepEqual(f.calls[1].args,{p_job_id:'job',p_worker_id:'worker',p_loaded_miles:null,
      p_deadhead_miles:null,p_provider:null,p_failed:true,p_error_code:'DRIVER_PAY_PROVIDER_UNAVAILABLE'});
    assert.ok(!JSON.stringify(f.calls).includes('SECRET'));
  }
});

test('invalid saved route input becomes a safe terminal failure without provider calls',async()=>{
  const validStops=[{type:'pickup',address_line:'25 Gill Ave',city:'Rockaway',region:'NJ'},
    {type:'delivery',address_line:'7027 W Brightwater Way',city:'Tucson',region:'AZ'}];
  assert.doesNotThrow(()=>validateDriverPayStops(validStops));
  for(const address_line of ['', 'Rockaway, NJ', '25', '25City', ' 25 Gill Ave']) {
    const stops=[{...validStops[0],address_line},validStops[1]];
    assert.throws(()=>validateDriverPayStops(stops),error=>error.code==='DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE');
  }
  for(const stops of [null, [], [validStops[0]], [validStops[1],validStops[0]], [null,validStops[1]]]) {
    assert.throws(()=>validateDriverPayStops(stops),error=>error.code==='DRIVER_PAY_ROUTE_INVALID');
  }
  const f=fixture({...lease,stops:[{...validStops[0],city:' '},validStops[1]]});
  const result=await processDriverStartPay(f.client,'worker',null,()=>'',async(stops,origin)=>
    calculateStartDriverPayRoute(stops,origin,'',()=>assert.fail('Invalid route must not call a provider'),'token'));
  assert.deepEqual(result,{claimed:1,completed:0,failed:1});
  assert.equal(f.calls[1].args.p_error_code,'DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE');
  assert.equal(f.calls[1].args.p_loaded_miles,null);
  const invalid=fixture();
  await processDriverStartPay(invalid.client,'worker',null,()=>'',async()=>{
    throw new DriverPayRouteError('DRIVER_PAY_ROUTE_INVALID','Private saved data details');
  });
  assert.equal(invalid.calls[1].args.p_error_code,'DRIVER_PAY_ROUTE_INVALID');
  assert.ok(!JSON.stringify(invalid.calls).includes('Private saved'));
  const forged=fixture();
  await processDriverStartPay(forged.client,'worker',null,()=>'',async()=>{
    throw {code:'DRIVER_PAY_ROUTE_INVALID',message:'Untrusted provider'};
  });
  assert.equal(forged.calls[1].args.p_error_code,'DRIVER_PAY_PROVIDER_UNAVAILABLE');
});
test('saved origin routing accepts old immutable fix and covers every ordered route leg',async()=>{
  const stops=[1,2,3,4].map((n)=>({id:String(n),type:n<3?'pickup':'delivery',address_line:`${n} Road`,city:'City',region:'NJ',postal_code:'12345'}));
  const roads=[];
  const fetcher=async input=>{
    const url=new URL(input);
    if(url.pathname.includes('/forward')) {
      const n=Number(url.searchParams.get('q').split(' ')[0]);
      return Response.json({features:[{geometry:{type:'Point',coordinates:[-74+n/100,40]},properties:{
        feature_type:'address',match_code:{confidence:'exact',street:'matched'},context:{
          address:{address_number:String(n)},region:{region_code:'NJ'},country:{country_code:'US'},postcode:{name:'12345'},
        }}}]});
    }
    assert.ok(url.pathname.includes('/directions/'));
    roads.push(url.pathname.split('/').at(-1));
    return Response.json({code:'Ok',routes:[{geometry:'_p~iF~ps|U_ulLnnqC_mqNvxq`@',distance:16093.44,duration:600}]});
  };
  const result=await calculateStartDriverPayRoute(stops,lease.origin,'',fetcher,'public-token');
  assert.equal(result.loadedMiles,30); assert.equal(result.deadheadMiles,10);
  assert.equal(roads.length,4); assert.equal(roads.at(-1),'-74,40;-73.99,40');
  assert.equal(lease.origin.capturedAt,'2026-01-01T00:00:00Z');
  await assert.rejects(calculateStartDriverPayRoute(stops,{...lease.origin,latitude:NaN},'',fetcher,'token'),/Invalid saved START/);
});
