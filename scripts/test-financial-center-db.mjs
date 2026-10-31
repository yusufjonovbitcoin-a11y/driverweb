import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { withIsolatedPostgres } from './isolated-postgres.mjs';

await withIsolatedPostgres(async ({ sql, root }) => {
  sql(await readFile(path.join(root, 'scripts/settlement-test-fixtures/bootstrap.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'supabase/migrations/20261024130206_durable_driver_settlements.sql'), 'utf8'));
  sql(`
    alter table loads add load_number text, add broker_name text, add broker_rate numeric default 1000,
      add loaded_miles numeric default 500, add driver_brief jsonb,
      add created_at timestamptz default now(), add updated_at timestamptz default now();
    alter table assignments add accepted_price_snapshot_id uuid, add assigned_at timestamptz default now(), add ended_at timestamptz;
    alter table company_accounting_settings add broker_commission_percent numeric default 10, add settlement_defaults jsonb,
      add updated_at timestamptz default now();
    create table load_price_snapshots(id uuid primary key, company_id uuid, load_id uuid, broker_rate numeric, loaded_miles numeric);
    create table load_stops(id uuid primary key,company_id uuid,load_id uuid,city text,region text,type text,sequence integer);
    create table load_accounting(load_id uuid primary key,company_id uuid,additional_income numeric,driver_pay numeric,
      fuel_cost numeric,toll_cost numeric,other_cost numeric,broker_paid numeric,notes text,version bigint,updated_at timestamptz);
    create table assignment_driver_pay(assignment_id uuid primary key,load_id uuid,company_id uuid,driver_id uuid,amount numeric,currency text,loaded_miles numeric);
    grant select on profiles,loads,assignments,company_accounting_settings,load_price_snapshots,load_stops,load_accounting,assignment_driver_pay to authenticated;
    do $$declare n text;begin foreach n in array array['profiles','loads','assignments','company_accounting_settings','load_price_snapshots','load_stops','load_accounting','assignment_driver_pay'] loop
      execute format('alter table %I enable row level security',n);
      execute format('create policy tenant_read on %I for select to authenticated using (company_id=(select public.current_company_id()))',n);
    end loop;end$$;
    insert into loads(id,company_id,status) select gen_random_uuid(),'00000000-0000-0000-0000-000000000100','completed' from generate_series(1,201);
    insert into loads(id,company_id,status) values('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000200','completed');
    update loads set trashed_at=now() where id='00000000-0000-0000-0000-000000000024';
    insert into driver_settlements(id,company_id,driver_id,approved_by,number,period_from,period_to,gross_cents,net_cents,load_count,snapshot,summary,storage_path,file_name,sha256,size_bytes)
    values('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',1,'2026-10-01','2026-10-07',10000,9000,1,
      test_statement('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000021'),'{}','isolated.pdf','isolated.pdf',repeat('a',64),1);
    insert into driver_settlement_loads values('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000070');
  `);
  sql(await readFile(path.join(root, 'supabase/migrations/20261025060531_financial_center_consistent_snapshot.sql'), 'utf8'));
  sql('alter table loads add constraint loads_company_id_load_number_key unique(company_id,load_number);');
  sql('begin;' + await readFile(path.join(root, 'supabase/migrations/20261031173226_unique_internal_load_numbers.sql'), 'utf8') + 'commit;');
  const read = suffix => JSON.parse(sql(`set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-${suffix}';select public.get_financial_center_snapshot();`));
  const admin = read('000000000001');
  assert.equal(admin.schemaVersion, 1);
  assert.equal(admin.total, 204);
  assert.equal(admin.rows.length, 204);
  assert.ok(admin.rows.every(row => Number(row.internal_number) >= 100));
  assert.equal(new Set(admin.rows.map(row => row.internal_number)).size, admin.rows.length);
  assert.equal(admin.loads.length, 204);
  assert.equal(admin.settlements[0].calculation.net, 9000);
  assert.equal(admin.settlements[0].calculation.rows[0].load.id, '00000000-0000-0000-0000-000000000021');
  assert.equal(admin.settlements[0].calculation.rows[0].gross, 10000);
  assert.equal(admin.rows.some(row => row.id.endsWith('000000000099') || row.id.endsWith('000000000024')), false);
  assert.equal(admin.settlementsAvailable, true);
  assert.equal(read('000000000003').settlements.length, 0);
  assert.equal(read('000000000003').settlementsAvailable, false);
  assert.equal(read('000000000004').total, 1);
  for (const id of ['000000000005','000000000010']) assert.throws(() => read(id), /ACCOUNTING_PERMISSION/);
  assert.throws(() => sql('set role anon;select public.get_financial_center_snapshot();'), /permission denied/);
  assert.equal(sql("select provolatile from pg_proc where oid='public.get_financial_center_snapshot()'::regprocedure;").trim(), 's');
  assert.equal(sql("select prosecdef from pg_proc where oid='public.get_financial_center_snapshot()'::regprocedure;").trim(), 'f');
  console.log('PASS: 204-row atomic snapshot, approved immutable figures, trash exclusion, tenant/role/RLS isolation, anonymous denial and STABLE invoker execution');
}, { port: 55451 });
