import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { withIsolatedPostgres } from './isolated-postgres.mjs';

await withIsolatedPostgres(async ({sql, root, bin, connection}) => {
  sql(await readFile(path.join(root, 'scripts/settlement-test-fixtures/bootstrap.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'supabase/migrations/20261024130206_durable_driver_settlements.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'supabase/migrations/20261024132752_settlement_pdf_referential_integrity.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'scripts/settlement-test-fixtures/checks.sql'), 'utf8'));
  function request(text) {
    return new Promise((resolve,reject) => {
      const child=spawn(path.join(bin,'psql'),connection,{cwd:root});let out='',err='';
      const deadline=setTimeout(()=>{child.kill();reject(Error('Settlement concurrency test timed out'));},10000);
      child.on('error',reject);child.stdout.on('data',s=>{out+=s});child.stderr.on('data',s=>{err+=s});
      child.on('close',code=>{clearTimeout(deadline);resolve({code,out,err})});child.stdin.end(text);
    });
  }
  // Different IDs, same load: the database must choose exactly one winner.
  const input=id=>`set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';select id from confirm_driver_settlement('${id}',test_statement('${id}','00000000-0000-0000-0000-000000000022'), 'statement.pdf',repeat('a',64),20);`;
  const [first,second]=await Promise.all([request(input('00000000-0000-0000-0000-000000000072')),request(input('00000000-0000-0000-0000-000000000073'))]);
  assert.equal([first,second].filter(r=>r.code===0).length,1);
  assert.match([first,second].find(r=>r.code!==0).err,/SETTLEMENT_ALREADY_CONFIRMED/);
  assert.equal(sql("select count(*) from driver_settlement_loads where load_id='00000000-0000-0000-0000-000000000022';").trim(),'1');
  assert.throws(() => sql("delete from storage.objects where id in (select storage_object_id from driver_settlements);"), /settlement_pdf_object_fk/);
  console.log('PASS: durable PDF/snapshot, immutable bytes, stable reference, retry idempotency, stale revisions, role/tenant isolation and concurrent duplicate prevention');
});
