import test from 'node:test';import assert from 'node:assert/strict';
import {confirmDriverSettlement,readDriverSettlements,readDriverSettlement,readSettlementPdf}from'./driverSettlements.js';
const id='00000000-0000-0000-0000-000000000070',driver='00000000-0000-0000-0000-000000000010',actor='00000000-0000-0000-0000-000000000001',company='00000000-0000-0000-0000-000000000100';
const entry=()=>({id:'calc:test',deliveryId:id,driver:{id:driver,name:'Driver'},settingsVersion:1,approvalStatus:'approved',calculation:{gross:10000,net:9000,period:{from:'2026-10-01',to:'2026-10-07'},rows:[{load:{id:'load',driverId:driver}}]}});
const pdf=()=>({blob:new Blob(['%PDF-test bytes'],{type:'application/pdf'}),fileName:'statement.pdf'});
function backend(){let record,blob,lose=false;const calls=[];let denied=false;
 const client={auth:{getUser:async()=>({data:{user:{id:actor}}})},from(table){const state={table};const q={select(cols){state.cols=cols;calls.push([table,cols]);return this},eq(){return this},single(){state.single=true;return this},order(){return this},limit(){return this},gt(){state.exhausted=true;return this},abortSignal(){return this},then(resolve){if(denied)return resolve({error:{code:'42501'}});return resolve({data:table==='profiles'?{id:actor,company_id:company,role:'company_admin',status:'active'}:state.single?record:state.exhausted?[]:record?[record]:[],error:null})}};return q},storage:{from(){return {async upload(path,value){calls.push(['upload',path]);if(blob)return{error:{status:409,message:'already exists'}};blob=value;return{}},async download(){calls.push(['download']);return{data:blob}}}},},async rpc(name,payload){calls.push(['rpc',name]);if(record&&record.sha256!==payload.p_sha256)return{error:Error('SETTLEMENT_ID_CONFLICT')};record={id,number:1,approved_at:'2026-10-24T12:00:00Z',summary:structuredClone(payload.p_snapshot),snapshot:structuredClone(payload.p_snapshot),storage_path:'private/statement.pdf',file_name:payload.p_file_name,sha256:payload.p_sha256,size_bytes:payload.p_size_bytes};if(lose){lose=false;return{error:Error('connection lost')}}return{data:record}}};
 return {client,calls,loseNext(){lose=true},deny(){denied=true},corrupt(){blob=new Blob(['wrong PDF bytes'],{type:'application/pdf'})}};
}
test('confirmation persists exact edited snapshot and bytes; list is lightweight and details survive a new read',async()=>{
 const b=backend(),s=entry(),file=pdf();s.calculation.net=1234;
 const saved=await confirmDriverSettlement(b.client,s,file);assert.equal(saved.calculation.net,1234);assert.equal(saved.reference,'#0001');
 const list=await readDriverSettlements(b.client);assert.equal(list.length,1);assert.equal(list[0].complete,false);
 assert.ok(b.calls.filter(x=>x[0]==='driver_settlements'&&x[1]).some(x=>!x[1].includes('snapshot')));
 const detail=await readDriverSettlement(b.client,id);assert.equal(detail.calculation.net,1234);
 assert.equal(await(await readSettlementPdf(b.client,detail)).text(),await file.blob.text());
});
test('lost confirmation acknowledgement retries same ID and original PDF without replacing bytes',async()=>{
 const b=backend(),s=entry(),file=pdf();b.loseNext();await assert.rejects(confirmDriverSettlement(b.client,s,file),/connection lost/);
 const saved=await confirmDriverSettlement(b.client,s,file);assert.equal(saved.id,id);assert.equal(b.calls.filter(x=>x[0]==='rpc').length,2);
});
test('a same-path upload with different bytes cannot be confirmed',async()=>{
 const b=backend(),s=entry(),file=pdf();await confirmDriverSettlement(b.client,s,file);
 await assert.rejects(confirmDriverSettlement(b.client,s,{...file,blob:new Blob(['different'],{type:'application/pdf'})}),/SETTLEMENT_ID_CONFLICT/);
});
test('opening cached metadata rechecks permission and verifies stored PDF integrity',async()=>{
 const b=backend(),saved=await confirmDriverSettlement(b.client,entry(),pdf());b.deny();
 await assert.rejects(readSettlementPdf(b.client,saved),e=>e.code==='42501');assert.equal(b.calls.filter(x=>x[0]==='download').length,0);
 const other=backend(),document=await confirmDriverSettlement(other.client,entry(),pdf());other.corrupt();await assert.rejects(readSettlementPdf(other.client,document),/SETTLEMENT_PDF_INVALID/);
});
test('demo and unapproved statements never upload or call the live confirmation RPC',async()=>{
 for(const patch of [{isDemo:true},{approvalStatus:'draft'}]){const b=backend();await assert.rejects(confirmDriverSettlement(b.client,{...entry(),...patch},pdf()),/SETTLEMENT_INVALID/);assert.equal(b.calls.length,0)}
});
