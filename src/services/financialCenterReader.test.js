import test from 'node:test';
import assert from 'node:assert/strict';
import { readFinancialCenter } from './financialCenterReader.js';

function snapshot() {
  const rows=Array.from({length:205},(_,i)=>({id:String(i).padStart(4,'0')}));
  return {schemaVersion:1,total:rows.length,rows,loads:rows.map(row=>({id:row.id})),pay:[],settings:null,settlements:[],settlementsAvailable:true,fetchedAt:'2026-10-25T12:00:00Z'};
}
function clientFor(data,error=null) {
  const calls=[];
  return {
    calls,
    rpc(name) {
      calls.push(name);
      return {
        abortSignal(signal) { calls.push(signal); return this; },
        then(resolve,reject) { return Promise.resolve({data,error}).then(resolve,reject); },
      };
    },
  };
}
test('one RPC supplies a complete snapshot larger than a REST page, including approved calculations',async()=>{
  const client=clientFor(snapshot()), signal=new AbortController().signal;
  const result=await readFinancialCenter(client,signal);
  assert.equal(result.rows.length,205);assert.equal(result.loads.length,205);
  assert.deepEqual(client.calls,['get_financial_center_snapshot',signal]);
});
test('reader rejects permission failure, truncation, duplicate rows and mismatched metadata',async()=>{
  await assert.rejects(readFinancialCenter(clientFor(null,{code:'42501',message:'ACCOUNTING_PERMISSION'})),e=>e.code==='42501');
  for(const change of [s=>s.rows.pop(),s=>s.rows[1]=s.rows[0],s=>s.loads[1].id='different',s=>s.schemaVersion=2,s=>s.total=204]) {
    const data=snapshot();change(data);await assert.rejects(readFinancialCenter(clientFor(data)),/ANALYTICS_INVALID_RESPONSE/);
  }
});
test('corrupt or duplicated approved calculations fail closed instead of falling back to an estimate',async()=>{
  const data=snapshot();
  data.settlements=[{id:'s',driverId:'d',calculation:{rows:[]}}];
  await assert.rejects(readFinancialCenter(clientFor(data)),/ANALYTICS_INVALID_SETTLEMENT/);
});
