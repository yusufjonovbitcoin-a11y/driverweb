import test from 'node:test';
import assert from 'node:assert/strict';
import { completionEvidence, completeStaffLoad, applyStaffLoadCompletion } from './staffLoadCompletion.js';
const load = { id: 'load', currentAssignmentId: 'assignment', driverId: 'driver', databaseStatus: 'assigned', version: 8 };
const context = { stops: [{ id:'p',type:'pickup' },{ id:'d',type:'delivery' }], documentItems:[
  { stop_id:'p',document_type:'bol',current_version_id:'v1' },{ stop_id:'d',document_type:'pod',current_version_id:'v2' },
] };
const request = { operationId:'operation',versionIds:['v1','v2'],deliveredLocal:'2026-10-28T14:00:00',timeZone:'UTC',note:'' };
const ack = {loadId:'load',assignmentId:'assignment',driverId:'driver',operationId:'operation',status:'completed',driverStage:'completed',version:9,
  deliveredAt:'2026-10-28T14:00:00Z',completedAt:'2026-11-01T00:00:00Z'};
test('completion requires each saved pickup BOL and delivery POD, never a load-level or missing document',()=>{
  assert.deepEqual(completionEvidence(load,context).versionIds,['v1','v2']);
  assert.equal(completionEvidence(load,null),null);
  for(const change of [{documentItems:context.documentItems.slice(0,1)},
    {documentItems:context.documentItems.map(d=>({...d,stop_id:null}))},
    {stops:[...context.stops,{id:'d2',type:'delivery'}]},
    {documentItems:context.documentItems.map(d=>({...d,current_version_id:null}))}]) {
    assert.equal(completionEvidence(load,{...context,...change}),null);
  }
  for(const change of [{databaseStatus:'completed'},{trashedAt:'yesterday'},{currentAssignmentId:null},
    {executionResetAt:'2026-11-01T00:00:00Z'}]) assert.equal(completionEvidence({...load,...change},context),null);
});
test('only a matching server acknowledgement can mark a trip completed',async()=>{
  assert.equal(await completeStaffLoad({rpc:async(name,args)=>{
    assert.equal(name,'complete_staff_load'); assert.equal(args.p_expected_version,8);
    assert.deepEqual(args.p_document_versions,['v1','v2']); return {data:ack};
  }},load,request),ack);
  for(const patch of [{assignmentId:'other'},{driverId:'other'},{version:8},{status:'assigned'},{deliveredAt:'bad'}]) {
    await assert.rejects(completeStaffLoad({rpc:async()=>({data:{...ack,...patch}})},load,request),/INVALID_RESPONSE/);
  }
});
test('lost response reconciles only an exact saved request',async()=>{
  const receipt={...ack,request:{baseVersion:8,documentVersions:['v1','v2'],deliveredLocal:request.deliveredLocal,timeZone:'UTC',note:''}};
  const client = receipt => ({rpc:async name=>name==='complete_staff_load'?{error:new Error('Offline')}:{data:receipt}});
  assert.equal((await completeStaffLoad(client(receipt),load,request)).status,'completed');
  for(const patch of [{baseVersion:9},{documentVersions:['other']},{timeZone:'America/New_York'},{note:'changed'}])
    await assert.rejects(completeStaffLoad(client({...receipt,request:{...receipt.request,...patch}}),load,request),/Offline/);
});
test('a late completion cannot overwrite a replacement assignment or newer workspace version',()=>{
  const updated=applyStaffLoadCompletion(load,ack);
  assert.equal(updated.status,'COMPLETED');assert.equal(updated.deliveredAt,ack.deliveredAt);
  for(const changed of [{...load,currentAssignmentId:'replacement'},{...load,version:10},{...load,driverId:'different'}])
    assert.equal(applyStaffLoadCompletion(changed,ack),changed);
});
