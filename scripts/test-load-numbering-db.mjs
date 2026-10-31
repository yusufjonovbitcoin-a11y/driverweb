import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { withIsolatedPostgres } from './isolated-postgres.mjs';

await withIsolatedPostgres(async ({ sql, root, bin, connection }) => {
  sql(`create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create table profiles(id uuid,company_id uuid,role text,status text);
    create table loads(id uuid primary key default gen_random_uuid(),company_id uuid not null,
      load_number text not null,created_at timestamptz default now(),updated_at timestamptz default now(),version bigint default 1,
      unique(company_id,load_number));
    insert into loads(company_id,load_number,updated_at) values
      ('00000000-0000-0000-0000-000000000001','REF-A','2026-01-01'),
      ('00000000-0000-0000-0000-000000000002','REF-A','2026-01-02');
    create table originals as select * from loads;
    alter table loads enable row level security;
    create policy tenant_read on loads for select to authenticated using(company_id=auth.uid());
    grant usage on schema public,auth to authenticated; grant select on loads to authenticated;
    create view load_overview with(security_invoker=true) as select id,company_id,load_number from loads;
    grant select on load_overview to authenticated;
  `);
  sql('begin;' + await readFile(path.join(root, 'supabase/migrations/20261031173226_unique_internal_load_numbers.sql'), 'utf8') + 'commit;');
  assert.equal(sql('select min(internal_number)||\',\'||max(internal_number)||\',\'||count(distinct internal_number) from loads;').trim(), '100,101,2');
  assert.equal(sql('select bool_and(l.updated_at=o.updated_at and l.version=o.version and l.load_number=o.load_number) from loads l join originals o using(id);').trim(), 't');
  const create = `insert into loads(company_id,load_number) values('00000000-0000-0000-0000-000000000001','REF-A') returning internal_number;`;
  assert.equal(sql(create).trim(), '102');
  sql('delete from loads where internal_number=102;');
  assert.equal(sql(create).trim(), '103');
  sql('begin;' + create + 'rollback;');
  assert.equal(sql(create).trim(), '105');
  assert.throws(() => sql('update loads set internal_number=999 where internal_number=100;'), /IMMUTABLE|GENERATED ALWAYS/);
  assert.throws(() => sql('update loads set internal_number=default where internal_number=100;'), /IMMUTABLE/);
  assert.throws(() => sql("insert into loads(company_id,load_number,internal_number) values('00000000-0000-0000-0000-000000000001','X',100);"), /GENERATED ALWAYS/);
  const tenantRead = id => sql(`set role authenticated;set "test.user"='00000000-0000-0000-0000-${id}'; select count(*) from load_overview;`).trim();
  assert.equal(tenantRead('000000000001'), '3');
  assert.equal(tenantRead('000000000002'), '1');
  assert.throws(() => sql('set role anon;select * from load_overview;'), /permission denied/);
  const insertAsync = () => new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, 'psql'), connection, { cwd: root });
    let out = '', err = '';
    const deadline = setTimeout(() => { child.kill(); reject(Error('numbering test timeout')); }, 10000);
    child.on('error', reject); child.stdout.on('data', s => out += s); child.stderr.on('data', s => err += s);
    child.on('close', code => { clearTimeout(deadline); if (code) reject(Error(err)); else resolve(Number(out.trim())); });
    child.stdin.end(create);
  });
  const numbers = await Promise.all(Array.from({ length: 16 }, insertAsync));
  assert.equal(new Set(numbers).size, 16);
  assert.ok(numbers.every(n => n > 105));
  assert.equal(sql('select count(*)=count(distinct internal_number) from loads;').trim(), 't');
  assert.equal(sql("select attidentity from pg_attribute where attrelid='loads'::regclass and attname='internal_number';").trim(), 'a');
  assert.equal(sql("select seqcycle from pg_sequence where seqrelid=pg_get_serial_sequence('loads','internal_number')::regclass;").trim(), 'f');
  console.log('PASS: 100-based backfill, unchanged history, repeated broker references, immutable automatic numbers, no deletion/rollback reuse, 16 concurrent inserts, tenant isolation');
}, { port: 55452 });
