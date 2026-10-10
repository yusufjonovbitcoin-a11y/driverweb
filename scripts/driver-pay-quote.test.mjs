import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDriverPay } from '../supabase/functions/_shared/driver-pay.ts';

const freshPresence = () => [{ driver_id:'driver',latitude:40,longitude:-74,is_online:true,
  last_seen_at:new Date().toISOString(),location_captured_at:new Date().toISOString() }];
function fixture({rate=0.65,assignment=null,settingsError=null,presence=freshPresence()}={}) {
  const stops = [1,2,3,4].map(n=>({id:`s${n}`,type:n<3?'pickup':'delivery',sequence:n,
    address_line:`${n} Road`,city:'City',region:'NJ',postal_code:'12345',latitude:null,longitude:null}));
  const data = {
    loads:{id:'load',current_assignment_id:assignment?'assignment':null},
    member_directory:{id:'driver',status:'active',role:'driver'},
    driver_pay_settings:{rate_per_mile:rate},assignments:assignment,
    load_stops:stops,driver_presence:presence,
  };
  const calls=[],reads=[];
  const client={from(table){
    reads.push(table);
    const builder={select(){return this;},eq(){return this;},order(){return this;},
      maybeSingle(){return this;},then(resolve,reject){return Promise.resolve({data:data[table],
        error:table==='driver_pay_settings'?settingsError:null}).then(resolve,reject);}};
    return builder;
  },rpc:async(name,args)=>{
    if(name==='can_access_driver') return {data:true,error:null};
    calls.push({name,args});return {error:null};}};
  return {client,calls,stops,reads};
}
const env=()=>'';
const ready=async()=>({loadedMiles:1200.12,provider:'mapbox',targets:[{
  driverId:'driver',status:'ready',deadheadMiles:50.25,originLatitude:40,originLongitude:-74,
  locationAt:'2026-10-06T00:00:00Z',
}]});
test('assignment waits for driver START even when fresh GPS is available',async()=>{
  const {client,calls,reads}=fixture();
  assert.deepEqual(await prepareDriverPay(client,client,'admin','load','driver'),
    {fixedPay:true,pending:true,reason:'awaiting_driver_start'});
  assert.deepEqual(calls,[]);
  assert.ok(!reads.includes('driver_presence') && !reads.includes('load_stops'));
});
test('no setting preserves ordinary assignment without requesting a route',async()=>{
  const {client,calls}=fixture({rate:null});
  assert.deepEqual(await prepareDriverPay(client,client,'admin','load','driver',()=>{throw Error('unneeded');},env),{fixedPay:false});
  assert.equal(calls.length,0);
});
test('missing, old or offline GPS permits assignment without a guessed quote or route request',async()=>{
  const recent=freshPresence()[0];
  for(const presence of [[],[{...recent,latitude:null}],[{...recent,is_online:false}],
    [{...recent,location_captured_at:new Date(Date.now()-121_000).toISOString()}],
    [{...recent,last_seen_at:new Date(Date.now()-121_000).toISOString()}]]) {
    const {client,calls}=fixture({presence});
    assert.deepEqual(await prepareDriverPay(client,client,'admin','load','driver',
      ()=>assert.fail('no route before START'),env), {fixedPay:true,pending:true,reason:'awaiting_driver_start'});
    assert.deepEqual(calls,[]);
  }
});
test('settings error is not confused with a driver opting out',async()=>{
  const {client}=fixture({settingsError:{message:'offline'}});
  await assert.rejects(prepareDriverPay(client,client,'admin','load','driver',ready,env),/settings unavailable/);
});
test('retry of existing assignment keeps original terms even if profile changed',async()=>{
  const {client,calls}=fixture({rate:1.5,assignment:{driver_id:'driver',status:'active'}});
  assert.deepEqual(await prepareDriverPay(client,client,'admin','load','driver',()=>{throw Error('unneeded');},env),{alreadyAssigned:true});
  assert.equal(calls.length,0);
});
