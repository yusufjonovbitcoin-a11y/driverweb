import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setAppLocale } from '../../src/i18n/index';
import SettlementPdfReview from '../../src/components/settlements/SettlementPdfReview';
import Statement from '../../src/components/settlements/Statement';
import { approveSettlement } from '../../src/components/settlements/settlementReviewModel';
import { calculatedStatementSnapshot } from '../../src/components/settlements/calculatedLoads';
import { createDemoApi, demoDrivers, demoLoads, demoInitialView } from '../fixtures/settlement-samples.js';
import { calculateSettlement, effectiveSettings } from '../../src/components/settlements/calculation';
import { confirmDriverSettlement, readDriverSettlements, readDriverSettlement, readSettlementPdf } from '../../src/services/driverSettlements';
import '../../src/index.css';import '../../src/workspace-design.css';import '../../src/components/settlements/settlements.css';
await setAppLocale('en',{persist:false});
const actor='00000000-0000-0000-0000-000000000001',company='00000000-0000-0000-0000-000000000100',driver='00000000-0000-0000-0000-000000000010';
const dbKey='owned-settlement-fixture';
const db=()=>JSON.parse(localStorage.getItem(dbKey)||'{"records":[],"files":{}}');
const save=value=>localStorage.setItem(dbKey,JSON.stringify(value));
const client={
 auth:{getUser:async()=>({data:{user:{id:actor}}})},
 from(table){let single=false,id,after;return {select(){return this},eq(key,value){if(key==='id')id=value;return this},single(){single=true;return this},order(){return this},limit(){return this},gt(key,value){after=value;return this},abortSignal(){return this},then(resolve){
  if(sessionStorage.getItem('fixture-denied'))return resolve({error:Error('permission revoked')});
  const rows=db().records.filter(r=>(!id||r.id===id)&&(!after||r.id>after));
  return resolve({data:table==='profiles'?{id:actor,company_id:company,role:'company_admin',status:'active'}:single?rows[0]:rows});
 }}},
 storage:{from(){return {async upload(path,blob){const data=db();if(data.files[path])return {error:{status:409,message:'already exists'}};
  data.files[path]=btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));save(data);return {};},
  async download(path){const data=db();return {data:new Blob([Uint8Array.from(atob(data.files[path]),c=>c.charCodeAt(0))],{type:'application/pdf'})};}
 }}},
 async rpc(name,p){const data=db();let record=data.records.find(r=>r.id===p.p_id);
  if(!record){record={id:p.p_id,number:data.records.length+1,approved_at:new Date().toISOString(),summary:p.p_snapshot,snapshot:p.p_snapshot,storage_path:`${company}/${driver}/${actor}/${p.p_id}.pdf`,file_name:p.p_file_name,sha256:p.p_sha256,size_bytes:p.p_size_bytes};data.records.push(record);save(data);}
  if(new URLSearchParams(location.search).has('lostAck')&&!data.ackLost){data.ackLost=true;save(data);throw Error('synthetic lost acknowledgement');}
  return {data:record};
 }
};
const settings=await createDemoApi().readCalculationSettings();
const source={driver:{...demoDrivers[0],id:driver},version:settings.version,company:{name:'T Fleets test'},calculation:calculateSettlement(demoLoads.filter(load=>demoInitialView.selected.includes(load.id)).map((load,i)=>({...load,id:`00000000-0000-0000-0000-00000000002${i}`,driverId:driver,version:1})),effectiveSettings(settings,demoDrivers[0].id),demoInitialView.period)};
export function Fixture(){
 const pending=useRef(null);
 const [open,setOpen]=useState(false),[entries,setEntries]=useState([]),[pdf,setPdf]=useState(null),[error,setError]=useState('');
 const refresh=()=>readDriverSettlements(client).then(setEntries);
 useEffect(()=>{void refresh();},[]);
 return <main><button onClick={()=>setOpen(true)}>New statement</button><button onClick={()=>sessionStorage.setItem('fixture-denied','1')}>Revoke permission</button>
 {entries.map(entry=><div key={entry.id}><span>{entry.reference}</span><output aria-label="Persisted Net">{entry.calculation.net}</output><button onClick={async()=>{try{setPdf(await readDriverSettlement(client,entry.id));}catch{setError('Permission denied');}}}>Open saved PDF</button></div>)}
 <output aria-label="Saved count">{entries.length}</output><p role="status">{error}</p>
 {open&&<SettlementPdfReview source={source} onClose={()=>setOpen(false)} onApprove={async(snapshot,file)=>{pending.current??=approveSettlement(snapshot);await confirmDriverSettlement(client,pending.current,file);await refresh();setOpen(false);}} />}
 {pdf&&<Statement snapshot={calculatedStatementSnapshot(pdf,false)} pdfLoader={entry=>readSettlementPdf(client,entry)} onClose={()=>setPdf(null)} />}
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
