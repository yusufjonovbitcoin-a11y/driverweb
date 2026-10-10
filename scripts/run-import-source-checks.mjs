import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function runImportSourceChecks({sql,migration,asyncSql,root}) {
  // Match actual Storage service metadata without making any provider calls.
  sql('alter table storage.objects add column owner_id text,add column metadata jsonb;');
  await migration('20261008182926_import_bound_source_document_upload.sql');
  await migration('20261008183307_import_source_stale_path_recovery.sql');
  sql(await readFile(path.join(root,'scripts/load-trash-test-fixtures/import-source-checks.sql'),'utf8'));
  const staff=`set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';`;
  const args=`'00000000-0000-0000-0000-000000022007',lpad('12007',64,'0')`;
  let unlock;
  const locked=new Promise(resolve=>{unlock=resolve;});
  const first=asyncSql(`begin; ${staff} select begin_import_document_upload(${args}); select 'IMPORT_LOCKED'; select pg_sleep(0.4); commit;`,
    out=>{if(out.includes('IMPORT_LOCKED'))unlock();});
  await Promise.race([locked,first.then(r=>{if(!r.stdout.includes('IMPORT_LOCKED'))throw new Error(r.stderr);})]);
  const second=asyncSql(`${staff} select begin_import_document_upload(${args});`);
  const [one,two]=await Promise.all([first,second]);
  assert.equal(one.code,0,one.stderr); assert.equal(two.code,0,two.stderr);
  const plan=JSON.parse(one.stdout.match(/\{[^\n]+\}/)[0]);
  assert.equal(JSON.parse(two.stdout.trim()).versionId,plan.versionId);
  sql(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('load-documents','${plan.storagePath}',
    '00000000-0000-0000-0000-000000000001','{"size":123,"mimetype":"application/pdf"}');`);
  const finish=`set role service_role; select complete_import_document_upload('00000000-0000-0000-0000-000000022007',
    '${plan.versionId}',lpad('12007',64,'0'),'00000000-0000-0000-0000-000000000001');`;
  let finishUnlock;
  const finishLocked=new Promise(resolve=>{finishUnlock=resolve;});
  const finishing=asyncSql(`begin; ${finish} select 'IMPORT_FINISH_LOCKED'; select pg_sleep(0.4); commit;`,
    out=>{if(out.includes('IMPORT_FINISH_LOCKED'))finishUnlock();});
  await Promise.race([finishLocked,finishing.then(r=>{if(!r.stdout.includes('IMPORT_FINISH_LOCKED'))throw new Error(r.stderr);})]);
  const replay=asyncSql(finish);
  const [done,again]=await Promise.all([finishing,replay]);
  assert.equal(done.code,0,done.stderr); assert.equal(again.code,0,again.stderr);
  sql(`select test_assert((select count(*)=1 from documents where load_id='00000000-0000-0000-0000-000000012007'),'concurrent import begin creates one original');
    select test_assert((select count(*)=1 from document_versions where document_id='${plan.documentId}'),'concurrent begin reuses one version');
    select test_assert((select count(*)=1 from audit_events where entity_id='${plan.documentId}' and action='document.import_source_uploaded'),'concurrent completion audits once');
    select test_assert((select count(*)=1 from jobs where idempotency_key='document-check:${plan.versionId}'),'concurrent completion enqueues once');`);
  console.log('PASS: import-bound Storage source upload, failed-draft recovery, scoped service attestation and concurrent idempotency');
}
