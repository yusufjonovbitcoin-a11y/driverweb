import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function runStaffDocumentChecks({sql,migration,asyncSql,root}) {
  // The focused harness has a minimal asset registry; add actual production
  // upload metadata columns before exercising the real RPC validation.
  sql('alter table media_assets add column uploaded_by uuid,add column mime_type text,add column size_bytes bigint;');
  await migration('202609240004_operational_hardening.sql', null, '-- NULL means all drivers.');
  await migration('20261008172549_staff_load_document_management.sql');
  sql(await readFile(path.join(root,'scripts/load-trash-test-fixtures/staff-document-checks.sql'),'utf8'));
  const staff=`set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';`;
  const prepared=JSON.parse(sql(`${staff} select begin_staff_document_upload('00000000-0000-0000-0000-000000009003','rate_confirmation',null,null,null,'race.pdf','application/pdf',123,'00000000-0000-0000-0000-000000009993');`).match(/\{[^\n]+\}/)[0]);
  sql(`insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
    values('00000000-0000-0000-0000-000000009994','00000000-0000-0000-0000-000000000020','load_document','${prepared.versionId}',
      '00000000-0000-0000-0000-000000000001','application/pdf',123);`);
  const command=`select complete_staff_document_upload('${prepared.versionId}','cloudinary:00000000-0000-0000-0000-000000009994',null);`;
  let notify;
  const locked=new Promise(resolve=>{notify=resolve;});
  const first=asyncSql(`begin; ${staff} ${command} select 'DOC_LOCKED'; select pg_sleep(0.4); commit;`,text=>{if(text.includes('DOC_LOCKED'))notify();});
  await Promise.race([locked,first.then(result=>{if(!result.stdout.includes('DOC_LOCKED'))throw new Error(result.stderr);})]);
  const second=asyncSql(`${staff} ${command}`);
  const [one,two]=await Promise.all([first,second]);
  assert.equal(one.code,0,one.stderr); assert.equal(two.code,0,two.stderr);
  sql(`select test_assert((select count(*)=1 from audit_events where entity_id='${prepared.documentId}' and action='document.staff_uploaded'),'concurrent commit replays one version/audit');
    select test_assert((select count(*)=1 from jobs where idempotency_key='document-check:${prepared.versionId}'),'concurrent commit enqueues one review');`);
  const prepareReplacement=(operationId)=>JSON.parse(sql(`${staff} select begin_staff_document_upload(
    '00000000-0000-0000-0000-000000009003','rate_confirmation',null,'${prepared.documentId}','${prepared.versionId}',
    'replacement.pdf','application/pdf',123,'${operationId}');`).match(/\{[^\n]+\}/)[0]);
  const left=prepareReplacement('00000000-0000-0000-0000-000000009995');
  const right=prepareReplacement('00000000-0000-0000-0000-000000009996');
  for(const [version,asset] of [[left,'00000000-0000-0000-0000-000000009997'],[right,'00000000-0000-0000-0000-000000009998']]) {
    sql(`insert into media_assets(id,company_id,scope,context_id,uploaded_by,mime_type,size_bytes)
      values('${asset}','00000000-0000-0000-0000-000000000020','load_document','${version.versionId}',
        '00000000-0000-0000-0000-000000000001','application/pdf',123);`);
  }
  let replacementLocked;
  const replacementReady=new Promise(resolve=>{replacementLocked=resolve;});
  const winner=asyncSql(`begin; ${staff} select complete_staff_document_upload('${left.versionId}',
    'cloudinary:00000000-0000-0000-0000-000000009997'); select 'REPLACEMENT_LOCKED'; select pg_sleep(0.4); commit;`,
    output=>{if(output.includes('REPLACEMENT_LOCKED'))replacementLocked();});
  await Promise.race([replacementReady,winner.then(result=>{if(!result.stdout.includes('REPLACEMENT_LOCKED'))throw new Error(result.stderr);})]);
  const loser=asyncSql(`${staff} select complete_staff_document_upload('${right.versionId}',
    'cloudinary:00000000-0000-0000-0000-000000009998');`);
  const [won,lost]=await Promise.all([winner,loser]);
  assert.equal(won.code,0,won.stderr); assert.notEqual(lost.code,0); assert.match(lost.stderr,/STAFF_DOCUMENT_CONFLICT/);
  sql(`select test_assert((select current_version_id='${left.versionId}' from documents where id='${prepared.documentId}'),
    'concurrent different replacements keep first committed pointer');
    select test_assert(not exists(select 1 from jobs where idempotency_key='document-check:${right.versionId}'),
    'rejected stale replacement cannot queue review or overwrite newer evidence');`);
  console.log('PASS: staff documents preserve immutable history/privacy, scoped optimistic changes, old-worker fencing and concurrent commit');
}
