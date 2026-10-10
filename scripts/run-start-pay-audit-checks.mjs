import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function runStartPayAuditChecks({sql,migration,asyncSql,root}) {
  const legacyHash=sql("select md5(string_agg(to_jsonb(p)::text,'' order by assignment_id)) from assignment_driver_pay p;");
  await migration('20261008164042_driver_start_pay_audit_hardening.sql');
  assert.equal(sql("select md5(string_agg(to_jsonb(p)::text,'' order by assignment_id)) from assignment_driver_pay p;"),legacyHash);
  sql(await readFile(path.join(root,'scripts/load-trash-test-fixtures/start-pay-audit-checks.sql'),'utf8'));
  const assignment=sql("select current_assignment_id from loads where id='00000000-0000-0000-0000-000000000903';").match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)[0];
  const staff=`set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';`;
  const command=`select retry_assignment_driver_pay('${assignment}','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000993');`;
  let notify;
  const locked=new Promise(resolve=>{notify=resolve;});
  const one=asyncSql(`begin; ${staff} ${command} select 'RETRY_LOCKED'; select pg_sleep(0.4); commit;`,out=>{if(out.includes('RETRY_LOCKED')) notify();});
  await Promise.race([locked,one.then(result=>{if(!result.stdout.includes('RETRY_LOCKED')) throw new Error(result.stderr);})]);
  const two=asyncSql(`${staff} ${command}`);
  const changed=asyncSql(`${staff} ${command.replace('000000000993','000000000994')}`);
  const [first,same,other]=await Promise.all([one,two,changed]);
  assert.equal(first.code,0,first.stderr); assert.equal(same.code,0,same.stderr);
  assert.match(first.stdout,/"status": "calculating"/);
  assert.notEqual(other.code,0); assert.match(other.stderr,/DRIVER_PAY_RETRY_UNAVAILABLE/);
  sql(`select test_assert((select count(*)=1 from audit_events where entity_id='${assignment}' and action='driver.pay_calculation_retried'),'concurrent staff retry requeues and audits exactly once');
    select test_assert((select attempt_count=0 and status='pending' from jobs where payload->>'assignmentId'='${assignment}'),'concurrent retry has one fresh attempt budget');
    select claim_driver_pay_calculation('audit-recovery-worker','${assignment}') as job \\gset
    select test_assert(finish_driver_pay_calculation((:'job'::jsonb->>'jobId')::uuid,'audit-recovery-worker',100,5,'mapbox',false,null),'retry settles via routed worker only');
    select test_assert((select rate_per_mile=0.9 and amount=94.5 and origin_latitude=41 and origin_longitude=-75 from assignment_driver_pay where assignment_id='${assignment}'),'retry preserves original rate and START GPS after profile rate changes');
    ${staff}
    select test_assert(get_assignment_driver_pay('${assignment}','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003')->>'status'='ready','atomic read transitions from pending to ready');
    select test_assert(retry_assignment_driver_pay('${assignment}','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000993')->>'status'='ready','idempotent staff retry after finalization returns current ready state');
    reset role;`);
  console.log('PASS: START pay audit guards, safe atomic projection, scoped retry, and concurrent replay');
}
