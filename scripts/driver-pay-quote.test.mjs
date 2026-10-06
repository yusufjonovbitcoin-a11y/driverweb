import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDriverPay } from '../supabase/functions/_shared/driver-pay.ts';

function fixture({rate=0.65,assignment=null,settingsError=null}={}) {
  const stops = [1,2,3,4].map(n=>({id:`s${n}`,type:n<3?'pickup':'delivery',sequence:n,
    address_line:`${n} Road`,city:'City',region:'NJ',postal_code:'12345',latitude:null,longitude:null}));
  const data = {
    loads:{id:'load',current_assignment_id:assignment?'assignment':null},
    member_directory:{id:'driver',status:'active',role:'driver'},
    driver_pay_settings:{rate_per_mile:rate},assignments:assignment,
    load_stops:stops,driver_presence:[],
  };
  const calls=[];
  const client={from(table){
    const builder={select(){return this;},eq(){return this;},order(){return this;},
      maybeSingle(){return this;},then(resolve,reject){return Promise.resolve({data:data[table],
        error:table==='driver_pay_settings'?settingsError:null}).then(resolve,reject);}};
    return builder;
  },rpc:async(name,args)=>{
    if(name==='can_access_driver') return {data:true,error:null};
    calls.push({name,args});return {error:null};}};
  return {client,calls,stops};
}
const env=()=>'';
const ready=async()=>({loadedMiles:1200.12,provider:'mapbox',targets:[{
  driverId:'driver',status:'ready',deadheadMiles:50.25,originLatitude:40,originLongitude:-74,
  locationAt:'2026-10-06T00:00:00Z',
}]});
test('all ordered stops and measured origin are bound into trusted quote',async()=>{
  const {client,calls,stops}=fixture();
  await prepareDriverPay(client,client,'admin','load','driver',async routeStops=>{
    assert.deepEqual(routeStops,stops); return ready();
  },env);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'prepare_driver_pay_quote');
  assert.equal(calls[0].args.p_stops.length,4);
  assert.equal(calls[0].args.p_loaded_miles,1200.12);
  assert.equal(calls[0].args.p_deadhead_miles,50.25);
  assert.equal(calls[0].args.p_rate,0.65);
});
test('no setting preserves ordinary assignment without requesting a route',async()=>{
  const {client,calls}=fixture({rate:null});
  assert.deepEqual(await prepareDriverPay(client,client,'admin','load','driver',()=>{throw Error('unneeded');},env),{fixedPay:false});
  assert.equal(calls.length,0);
});
test('unavailable GPS or bad distance cannot generate a zero-value snapshot',async()=>{
  for(const route of [async()=>({targets:[{driverId:'driver',status:'gps_unavailable'}]}),
    async()=>({...await ready(),loadedMiles:NaN})]) {
    const {client,calls}=fixture();
    await assert.rejects(prepareDriverPay(client,client,'admin','load','driver',route,env),/DRIVER_PAY_/);
    assert.equal(calls.length,0);
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
