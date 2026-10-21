import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const run = promisify(execFile),
  [db, port] = process.argv.slice(2);
if (!/^tms_finance_test_\d+$/.test(db) || !/^\d+$/.test(port))
  throw new Error("Disposable local test database required");
const sql = async (query, actor = true) => {
  const { stdout } = await run("psql", [
    "-h",
    "/tmp",
    "-p",
    port,
    "-d",
    db,
    "-tA",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    (actor
      ? "set role authenticated;select set_config('test.user','20000000-0000-0000-0000-000000000001',false);"
      : "") + query,
  ]);
  return stdout.trim().split("\n").at(-1);
};
await sql(
  "insert into loads(id,company_id,load_number,status,broker_name,broker_rate,loaded_miles,current_assignment_id) values('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','CONCURRENT','completed','Test Broker',100,10,'40000000-0000-0000-0000-000000000003');insert into assignments(id,company_id,driver_id,load_id,ended_at) values('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','2026-10-16T12:00:00Z');",
  false,
);
const create =
  'select finance_create_document(\'50000000-0000-0000-0000-000000000001\',\'invoice\',\'{"counterparty":"Test Broker","document_date":"2026-10-16","due_date":"2026-10-16","load_ids":["30000000-0000-0000-0000-000000000003"]}\');';
const created = await Promise.all([sql(create), sql(create)]);
assert.equal(created[0], created[1]);
const id = created[0];
const posted = await Promise.allSettled([
  sql(`select finance_document_action('${id}',1,'post');`),
  sql(`select finance_document_action('${id}',1,'post');`),
]);
assert.equal(posted.filter((r) => r.status === "fulfilled").length, 1);
assert.equal(posted.filter((r) => r.status === "rejected").length, 1);
const pay = `select finance_record_payment('50000000-0000-0000-0000-000000000002','${id}',25,'2026-10-16','bank','Concurrent payment');`;
const paid = await Promise.all([sql(pay), sql(pay)]);
assert.equal(paid[0], paid[1]);
assert.equal(
  await sql(
    `select sum(amount)::text from finance_payments where document_id='${id}';`,
  ),
  "25.00",
);
const race = await Promise.allSettled([
  sql(
    `select finance_record_payment(gen_random_uuid(),'${id}',60,'2026-10-16','bank','Concurrent ceiling');`,
  ),
  sql(
    `select finance_credit_invoice(gen_random_uuid(),'${id}',60,'Concurrent fee','5600');`,
  ),
]);
assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
assert.equal(race.filter((r) => r.status === "rejected").length, 1);
console.log(
  "PASS: concurrent create replay, CAS post, payment replay and payment/credit balance ceiling",
);
const version = await sql(
  "select version from finance_pay_rules where driver_id='20000000-0000-0000-0000-000000000002';",
);
await sql(
  `select finance_save_rule('20000000-0000-0000-0000-000000000002',${version},'percentage',20,0,true);`,
);
const frozen = await sql(
  'select finance_create_document(gen_random_uuid(),\'settlement\',\'{"counterparty":"Driver","driver_id":"20000000-0000-0000-0000-000000000002","document_date":"2026-10-16","due_date":"2026-10-16","period_from":"2026-10-16","period_to":"2026-10-16","load_ids":["30000000-0000-0000-0000-000000000003"]}\');',
);
assert.equal(
  await sql(`select total::text from finance_documents where id='${frozen}';`),
  "125.00",
);
console.log(
  "PASS: assignment-time pay template stays frozen after profile tariff changes",
);
await sql(
  "insert into profiles values('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','driver','active','Default-tariff driver');",
  false,
);
await sql("select finance_save_defaults(0,10);");
await sql(
  "insert into loads(id,company_id,load_number,status,broker_name,broker_rate,loaded_miles,current_assignment_id) values('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','DEFAULT-COMMISSION','completed','Test Broker',1000,10,'40000000-0000-0000-0000-000000000004');insert into assignments(id,company_id,driver_id,load_id,ended_at) values('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000004','2026-10-16T12:00:00Z');",
  false,
);
await sql("select finance_save_defaults(1,20);");
const companyDefault = await sql(
  'select finance_create_document(gen_random_uuid(),\'settlement\',\'{"counterparty":"Default-tariff driver","driver_id":"20000000-0000-0000-0000-000000000005","document_date":"2026-10-16","due_date":"2026-10-16","period_from":"2026-10-16","period_to":"2026-10-16","load_ids":["30000000-0000-0000-0000-000000000004"]}\');',
);
assert.equal(
  await sql(
    `select total::text from finance_documents where id='${companyDefault}';`,
  ),
  "900.00",
);
console.log(
  "PASS: global commission default and its assignment-time snapshot remain consistent",
);
