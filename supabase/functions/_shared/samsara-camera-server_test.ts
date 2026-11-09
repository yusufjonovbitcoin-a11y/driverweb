import { strict as assert } from 'node:assert';
import { cameraAction } from './samsara-camera-server.ts';
import { seal, SamsaraError } from './samsara-core.ts';
import type { Admin } from './samsara-server.ts';

async function fixture() {
  const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const rows: Record<string,any[]> = {samsara_connections:[{company_id:'company-a',generation:'generation-a',status:'active',snapshot:{vehicles:[{id:'truck-a'}]},credentials:await seal({access_token:'private-token',refresh_token:'refresh',expires_in:3600},'company-a',key),expires_at:new Date(Date.now()+3600000).toISOString()}],samsara_camera_requests:[]};
  const admin={
    async rpc(name: string,args: any) {
      if(name==='get_samsara_server_config') return {data:{SAMSARA_ENCRYPTION_KEY:key},error:null};
      const row=rows.samsara_connections.find(r=>r.company_id===args.p_company && !r.lease_id);
      if(row) row.lease_id=args.p_lease;
      return {data:row?[structuredClone(row)]:[],error:null};
    },
    from(table: string) {
      let filters: ((r:any)=>boolean)[]=[]; let patch:any=null; let insert:any=null; let single=false; let limit=Infinity;
      const query:any={
        select(){return query;},eq(key:string,value:any){filters.push(r=>r[key]===value);return query;},
        gte(key:string,value:any){filters.push(r=>r[key]>=value);return query;},order(){return query;},limit(value:number){limit=value;return query;},
        maybeSingle(){single=true;return query;},single(){single=true;return query;},update(value:any){patch=value;return query;},insert(value:any){insert=value;return query;},
        then(resolve:any,reject:any){return Promise.resolve().then(()=>{
          if(insert) rows[table].push({...insert,created_at:new Date().toISOString()});
          const data=rows[table].filter(r=>filters.every(f=>f(r))).slice(0,limit);
          if(patch) data.forEach(r=>Object.assign(r,patch));
          return {data:structuredClone(single?data[0]||null:data),error:null};
        }).then(resolve,reject);}
      };return query;
    }
  } as unknown as Admin;
  return {admin,rows};
}
const body = () => ({action:'create',id:crypto.randomUUID(),vehicleId:'truck-a',input:'dashcamRoadFacing',mediaType:'image',startTime:'2026-11-01T12:00:00Z',endTime:'2026-11-01T12:00:00Z'});

Deno.test('camera create reserves once; retries never repeat the quota-consuming provider call',async()=>{
  const {admin,rows}=await fixture(), request=body(); let calls=0;
  const api=async()=>{calls++;return {data:{retrievalId:'provider-private-id'}};};
  const first:any=await cameraAction(admin,'company-a','actor',request,api);
  const second:any=await cameraAction(admin,'company-a','actor',request,api);
  assert.equal(calls,1);assert.equal(first.request.state,'pending');assert.equal(second.request.id,request.id);
  assert.ok(!JSON.stringify(first).includes('provider-private-id'));assert.equal(rows.samsara_connections[0].lease_id,null);
});
Deno.test('ambiguous camera POST is persisted as unknown and not resent',async()=>{
  const {admin,rows}=await fixture(), request=body();let calls=0;
  const api=async()=>{calls++;throw new Error('timeout');};
  await assert.rejects(()=>cameraAction(admin,'company-a','actor',request,api),/REQUEST_UNCONFIRMED/);
  const again:any=await cameraAction(admin,'company-a','actor',request,api);
  assert.equal(calls,1);assert.equal(again.request.state,'unknown');assert.equal(rows.samsara_connections[0].lease_id,null);
});
Deno.test('foreign request IDs and obsolete connection generations cannot retrieve media',async()=>{
  const {admin,rows}=await fixture();let calls=0;
  const api=async()=>{calls++;return {data:{media:[]}};};
  for(const [company_id,generation] of [['company-b','generation-a'],['company-a','old-generation']]) {
    const id=crypto.randomUUID();rows.samsara_camera_requests.push({id,company_id,generation,vehicle_id:'truck-a',retrieval_id:'secret'});
    await assert.rejects(()=>cameraAction(admin,'company-a','actor',{...body(),action:'get',id},api),/RECORDING_NOT_FOUND/);
  }
  assert.equal(calls,0);
});
Deno.test('missing scope releases lease; reconnect during provider read prevents disclosure',async()=>{
  const {admin,rows}=await fixture();
  const request={...body(),action:'list',endTime:'2026-11-01T13:00:00Z'};
  await assert.rejects(()=>cameraAction(admin,'company-a','actor',request,async()=>{throw new SamsaraError('CAMERA_READ_REQUIRED');}),/CAMERA_READ_REQUIRED/);
  assert.equal(rows.samsara_connections[0].lease_id,null);
  await assert.rejects(()=>cameraAction(admin,'company-a','actor',request,async()=>{rows.samsara_connections[0].generation='new';return {data:{media:[]}};}),/RECONNECT_REQUIRED/);
  assert.equal(rows.samsara_connections[0].status,'active');
});
