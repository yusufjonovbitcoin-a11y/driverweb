import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// Fresh private-socket cluster; never reads app credentials or DATABASE_URL.
const root=fileURLToPath(new URL('..',import.meta.url)), dir=await mkdtemp(path.join(tmpdir(),'tfleets-native-call-'));
const bin=process.env.PG_BIN||'', connection=['-h',dir,'-p','55448','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'];
function run(exe,args,input){const r=spawnSync(path.join(bin,exe),args,{cwd:root,input,encoding:'utf8',maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw r.error||new Error(r.stderr+'\n'+r.stdout);if(r.stderr)process.stdout.write(r.stderr);return r.stdout;}
const sql=text=>run('psql',connection,text);
async function source(file,start,end){let text=await readFile(path.join(root,file),'utf8');if(start){assert(text.includes(start));text=text.slice(text.indexOf(start));}if(end){assert(text.includes(end));text=text.slice(0,text.indexOf(end));}return text;}
const migration=(name,start,end)=>source('supabase/migrations/'+name,start,end).then(sql);
function asyncSql(text,onOutput=()=>{}){return new Promise((resolve,reject)=>{const p=spawn(path.join(bin,'psql'),connection,{cwd:root});let out='',err='';const timer=setTimeout(()=>{p.kill();reject(new Error('Concurrency test timed out'));},10000);p.stdout.on('data',x=>{out+=x;onOutput(out);});p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});p.stdin.end(text);});}
// Keep a real transaction open until another connection is observed waiting.
function heldTransaction(text, marker) {
 const p=spawn(path.join(bin,'psql'),connection,{cwd:root}); let out='',err='',ready;
 const started=new Promise(resolve=>ready=resolve);
 const result=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{p.kill();reject(new Error('Held transaction timed out'));},10000);
  p.stdout.on('data',x=>{out+=x;if(out.includes(marker))ready();});p.stderr.on('data',x=>err+=x);
  p.on('error',reject);p.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});
 });
 p.stdin.write(text+'\n');
 return {ready:Promise.race([started,result.then(r=>{if(!r.out.includes(marker))throw new Error(r.err);})]),result,commit:()=>p.stdin.end('commit;\n')};
}
async function waitForDatabaseLock(applicationName) {
 for(let attempt=0;attempt<100;attempt++) {
  if(sql(`select exists(select 1 from pg_stat_activity where application_name='${applicationName}' and wait_event_type='Lock');`).trim()==='t')return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw new Error('Expected concurrent registration to wait for the held row lock');
}
let started=false;
try{
 run('initdb',['-D',dir+'/data','-A','trust','--no-locale','--encoding=UTF8']);run('pg_ctl',['-D',dir+'/data','-l',dir+'/server.log','-o',`-k ${dir} -h '' -p 55448 -c wal_level=logical`,'start']);started=true;
 sql(await source('scripts/chat-test-fixtures/bootstrap.sql'));
 await migration('20261001141119_chat_reliability_hardening.sql');
 await migration('20261004234608_chat_consistency_and_privacy.sql');
 await migration('20261005120609_chat_upload_lifecycle_and_worker_capacity.sql');
 sql(await source('scripts/native-call-test-fixtures/platform.sql'));
 sql(await source('scripts/native-call-test-fixtures/chat-safety-reference.sql'));
 await migration('20261007003538_chat_safety_controls.sql');
 await migration('202609260004_operational_integrity_and_push.sql','create or replace function public.register_push_device(', 'create or replace function public.unregister_push_device(');
 sql((await source('supabase/migrations/20261005011922_invoke_chat_workers_without_public_queue.sql')).replace('create extension if not exists http with schema extensions;',''));
 await migration('20261007003612_durable_document_check_worker.sql','-- Preserve the existing credential-safe synchronous transport.');
 await migration('20261007155627_native_incoming_call_delivery.sql');
 sql(await source('scripts/native-call-test-fixtures/checks.sql'));
 // Independent device requests with the same recipient JWT: only one claims it.
 const id=sql(`reset role;update chat_calls set status='ended' where status in('ringing','accepted');set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id;`).trim();
 const ids=sql(`reset role;select string_agg(id::text,',' order by token) from push_devices where token in('native-android-a-token','native-android-b-token');`).trim().split(',');
 let ready;const locked=new Promise(r=>ready=r);const prefix=`set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';`;
 const first=asyncSql(`begin;${prefix}select (claim_native_chat_call('${id}','${ids[0]}')).id;select 'CLAIM_LOCKED';select pg_sleep(0.25);commit;`,out=>{if(out.includes('CLAIM_LOCKED'))ready();});
 await Promise.race([locked,first.then(r=>{if(!r.out.includes('CLAIM_LOCKED'))throw new Error(r.err);})]);
 const second=asyncSql(`${prefix}select claim_native_chat_call('${id}','${ids[1]}');`);
 const [a,b]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.notEqual(b.code,0);assert.match(b.err,/CALL_ANSWERED_ELSEWHERE/);
 sql(`select test_assert((select accepted_device_id='${ids[0]}'::uuid from chat_calls where id='${id}'),'two-device race has exactly one answer winner');`);
 // The ownership check must be repeated after a concurrent transfer commits.
 const receiver=`set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';`;
 const foreign=`set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';`;
 const fcm='native-concurrent-transfer-token';
 sql(`${receiver}select register_push_device('${fcm}','ios');select register_voip_device(repeat('b',64),'sandbox','com.test.calls','${fcm}');`);
 const transfer=heldTransaction(`begin;${foreign}select register_push_device('${fcm}','ios');select 'TRANSFER_HELD';`,'TRANSFER_HELD');
 await transfer.ready;
 const oldOwnerLink=asyncSql(`set application_name='native-voip-transfer-regression';${receiver}select register_voip_device(repeat('b',64),'sandbox','com.test.calls','${fcm}');`);
 try { await waitForDatabaseLock('native-voip-transfer-regression'); } finally { transfer.commit(); }
 const [transferred,relinked]=await Promise.all([transfer.result,oldOwnerLink]);
 assert.equal(transferred.code,0,transferred.err);assert.notEqual(relinked.code,0,'old owner must not re-link after transfer');assert.match(relinked.err,/Owned iOS push device required/);
 sql(`select test_assert(not exists(select 1 from voip_devices v join push_devices p on p.id=v.fcm_device_id where v.disabled_at is null and (v.user_id,v.company_id) is distinct from (p.user_id,p.company_id)),'concurrent transfer cannot create an active cross-owner VoIP link');`);
 sql(`select test_assert((select disabled_at is not null from voip_devices where token=repeat('b',64)),'concurrent transfer leaves the old VoIP endpoint revoked');`);
 console.log('PASS: native call SQL, safety, durable fanout, credential-free wake, expiry, atomic device claim and concurrent ownership transfer');
}finally{if(started)run('pg_ctl',['-D',dir+'/data','-m','fast','stop']);await rm(dir,{recursive:true,force:true});}
