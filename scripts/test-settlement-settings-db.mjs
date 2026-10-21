import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only a disposable local PostgreSQL cluster and synthetic fixtures are used.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'settlement-settings-'));
const binary = process.env.PG_BIN || '/usr/lib/postgresql/18/bin';
function run(name, args, input) {
  const result = spawnSync(path.join(binary, name), args, { input, encoding: 'utf8', maxBuffer: 2 ** 21 });
  if (result.error || result.status !== 0) throw result.error || Error(result.stderr);
  return result.stdout.trim();
}
const sql = text => run('psql', ['-h', directory, '-p', '55443', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], text);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = n => `set role authenticated; set "test.user"='${id(n)}';`;
const settings = {
  schema: 1, currency: 'USD', partialWeeks: 'prorate', pdf: { loads: true, deductions: true, total: true },
  rules: ['company','dispatch','truck','trailer','insurance','eld','fuel','ifta','check','zelle'].map(id => ({
    id, enabled: true, method: 'percentage', frequency: 'per_load', basis: 'gross', value: '10.00', label: '',
  })),
};
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const save = (driver, version, config) => `select version from save_driver_calculation_settings(${driver ? `'${id(driver)}'` : 'null'},${version},${config === null ? 'null' : json(config)});`;
function fails(actorId, command, message) {
  assert.throws(() => sql(actor(actorId) + command), error => error.message.includes(message), command);
}
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55443`, 'start']);
  started = true;
  sql(await readFile(path.join(root, 'tests/finance/fixture.sql'), 'utf8'));
  sql(`alter table audit_events add column old_value jsonb;
    alter table assignments add column assigned_at timestamptz default '2026-01-01';
    create table client_operations(company_id uuid,load_id uuid,actor_id uuid,status text,command_type text,payload jsonb,result jsonb,occurred_at timestamptz,received_at timestamptz);
    insert into companies values ('${id(10)}'),('${id(20)}');
    insert into profiles values
      ('${id(1)}','${id(10)}','company_admin','active','Admin'),
      ('${id(2)}','${id(10)}','dispatcher','active','Dispatch'),
      ('${id(3)}','${id(10)}','driver','active','Driver'),
      ('${id(4)}','${id(20)}','company_admin','active','Other'),
      ('${id(5)}','${id(10)}','company_admin','suspended','Suspended'),
      ('${id(6)}','${id(20)}','driver','active','Other driver');`);
  for (const name of ['20261017215323_company_accounting_settings.sql','20261017215332_driver_calculation_settings.sql']) {
    sql(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  // Match production's actor helper: its locking read is incompatible with a
  // PostgREST read-only transaction, even for an otherwise read-only RPC.
  sql(`create or replace function public.current_profile() returns public.profiles
    language plpgsql security definer set search_path='' as $$
    declare actor public.profiles;
    begin select * into actor from public.profiles p where p.id=auth.uid() and p.status='active' for key share; return actor; end $$;`);
  assert.throws(() => sql(`begin read only; ${actor(1)} select driver_settlement_delivery_dates(); rollback;`), /read-only transaction/);
  sql(await readFile(path.join(root, 'supabase/migrations/20261017215828_settlement_delivery_transaction.sql'), 'utf8'));
  assert.equal(sql("select provolatile from pg_proc where oid='public.driver_settlement_delivery_dates()'::regprocedure;"), 'v');
  assert.equal(sql(actor(1) + 'select driver_settlement_delivery_dates();'), '{}');
  assert.equal(sql(actor(1) + save(null, 0, settings)), '1');
  assert.equal(sql(actor(1) + save(3, 1, settings)), '2');
  for (const who of [2, 3, 5]) fails(who, save(null, 2, settings), 'ACCOUNTING_PERMISSION_DENIED');
  fails(1, save(6, 2, settings), 'ACCOUNTING_PERMISSION_DENIED');
  fails(1, save(null, 1, settings), 'ACCOUNTING_VERSION_CONFLICT');
  fails(1, save(null, 2, { ...settings, rules: [...settings.rules.slice(0, 9), settings.rules[0]] }), 'ACCOUNTING_INVALID_SETTINGS');
  fails(1, save(null, 2, { ...settings, rules: settings.rules.map(r => ({ ...r, value: '101' })) }), 'ACCOUNTING_INVALID_SETTINGS');
  assert.equal(sql(actor(2) + 'select count(*) from company_accounting_settings;'), '1');
  for (const who of [3,4,5]) assert.equal(sql(actor(who) + 'select count(*) from company_accounting_settings;'), '0');
  fails(2, 'update company_accounting_settings set version=99;', 'permission denied');
  assert.throws(() => sql('set role anon; select * from company_accounting_settings;'), /permission denied/);
  assert.equal(sql(actor(1) + "select version from update_company_accounting_settings(15,2,'{\"fuel_weekly\":\"200.00\"}');"), '3');
  const record = JSON.parse(sql(actor(1) + 'select row_to_json(s) from company_accounting_settings s;'));
  const envelope = record.settlement_defaults.driver_settlement_v1;
  assert.deepEqual(envelope.drivers[id(3)], settings);
  assert.equal(envelope.company.rules[0].value, '15.00');
  assert.equal(envelope.company.rules[0].method, 'percentage');
  assert.deepEqual(envelope.company.rules.slice(1), settings.rules.slice(1));
  assert.equal(sql(actor(1) + save(3, 3, null)), '4');
  assert.equal(sql(actor(1) + "select settlement_defaults->>'fuel_weekly' from company_accounting_settings;"), '200.00');
  assert.equal(sql(actor(1) + "select settlement_defaults#>'{driver_settlement_v1,drivers}' from company_accounting_settings;"), '{}');
  console.log('PASS: company/driver saves, override reset, legacy preservation/synchronization, RLS/grants, validation and version conflict');

  sql(`insert into loads(id,company_id,status,current_assignment_id) values ('${id(100)}','${id(10)}','delivered','${id(101)}');
    insert into assignments(id,company_id,driver_id,load_id) values ('${id(101)}','${id(10)}','${id(3)}','${id(100)}');`);
  const event = (overrides = {}) => {
    const e = { actor: 3, company: 10, assignment: 101, stage: 'delivered', status: 'accepted', occurred: '2026-01-03 10:00Z', received: '2026-01-03 10:00Z', ...overrides };
    sql(`insert into client_operations values('${id(e.company)}','${id(100)}','${id(e.actor)}','${e.status}','advance_driver_stage','{"nextStage":"delivered"}','{"assignmentId":"${id(e.assignment)}","stage":"${e.stage}"}','${e.occurred}','${e.received}');`);
  };
  event({ stage: 'in_transit' }); event({ assignment: 999 }); event({ actor: 6 }); event({ company: 20 }); event({ status: 'rejected' });
  event({ occurred: '2025-12-31 10:00Z' }); event({ occurred: '2026-01-04 10:00Z' });
  assert.equal(sql(actor(1) + 'select driver_settlement_delivery_dates();'), '{}');
  event({ occurred: '2026-01-03 10:03Z' });
  assert.equal(Date.parse(JSON.parse(sql(actor(1) + 'select driver_settlement_delivery_dates();'))[id(100)]), Date.parse('2026-01-03T10:00:00Z'));
  assert.equal(sql(actor(4) + 'select driver_settlement_delivery_dates();'), '{}');
  fails(3, 'select driver_settlement_delivery_dates();', 'ACCOUNTING_PERMISSION_DENIED');
  sql(`update assignments set ended_at='2026-01-02' where id='${id(101)}';`);
  assert.equal(sql(actor(1) + 'select driver_settlement_delivery_dates();'), '{}');
  sql(`update assignments set ended_at=null; update loads set trashed_at=now();`);
  assert.equal(sql(actor(1) + 'select driver_settlement_delivery_dates();'), '{}');
  console.log('PASS: current final delivery only; intermediate/stale/cross-company/wrong-actor/future/pre-assignment/ended/trash excluded; tolerated clock skew capped at server receipt');
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'immediate', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
