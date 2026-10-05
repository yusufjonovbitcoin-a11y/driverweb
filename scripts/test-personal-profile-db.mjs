import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Dedicated temporary DB only. No production credentials or user records.
const directory = await mkdtemp(path.join(tmpdir(), 'drivex-profile-test-'));
const pgBin = process.env.PG_BIN || '';
const run = (binary, args, input) => {
  const result = spawnSync(path.join(pgBin, binary), args, { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
};
const sql = input => run('psql', ['-h', directory, '-p', '55441', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input);
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55441`, 'start']);
  started = true;
  sql(`create role anon; create role authenticated; create schema auth; create publication supabase_realtime;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
  `);
  // Real core table definitions, rather than a simplified profile schema.
  const core = await readFile(new URL('../supabase/migrations/202609240001_core_schema.sql', import.meta.url), 'utf8');
  // Storage service tables are unrelated to this profile-only test.
  assert.ok(core.includes('insert into storage.buckets'));
  sql(core.split('insert into storage.buckets')[0]);
  sql(`alter table public.profiles enable row level security; alter table public.companies enable row level security;
    grant select on public.profiles, public.companies to authenticated;
    create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
    create function public.test_assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',msg; end if; end $$;
    insert into public.companies(id,name) values ('00000000-0000-0000-0000-000000000010','Company A'),('00000000-0000-0000-0000-000000000020','Company B');
    insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
    insert into public.profiles(id,company_id,role,full_name,email) values
    ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','company_admin','Admin','admin@test.invalid'),
    ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','dispatcher','Staff','staff@test.invalid'),
    ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020','company_admin','Other','other@test.invalid');
  `);
  sql(await readFile(new URL('../supabase/migrations/20261005175048_editable_personal_profile.sql', import.meta.url), 'utf8'));
  sql(`set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
    select public.test_assert(public.update_my_profile(' New Admin ','+1 555','New Company')->>'full_name'='New Admin','saved trimmed name');
    reset role;
    select test_assert((select name='New Company' from companies where id='00000000-0000-0000-0000-000000000010'),'own company renamed');
    select test_assert((select name='Company B' from companies where id='00000000-0000-0000-0000-000000000020'),'other tenant unchanged');
    select test_assert((select email='admin@test.invalid' and role='company_admin' from profiles where id='00000000-0000-0000-0000-000000000001'),'email and role preserved');
    select test_assert((select count(*)=2 from audit_events),'audits saved');
    set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
    select public.update_my_profile('New Staff','');
    do $$ begin
      perform public.update_my_profile('Wrong Staff',null,'Forbidden Company');
      raise exception 'unexpected success';
    exception when insufficient_privilege then null; end $$;
    do $$ begin perform public.update_my_profile('x',null); raise exception 'unexpected success'; exception when invalid_parameter_value then null; end $$;
    do $$ begin perform public.update_my_profile('Staff','+++'); raise exception 'unexpected success'; exception when invalid_parameter_value then null; end $$;
    reset role;
    select test_assert((select full_name='New Staff' and phone is null from profiles where id='00000000-0000-0000-0000-000000000002'),'failed company edit rolled back own changes');
    update profiles set status='suspended' where id='00000000-0000-0000-0000-000000000002';
    set role authenticated;
    do $$ begin perform public.update_my_profile('Blocked',null); raise exception 'unexpected success'; exception when insufficient_privilege then null; end $$;
    set "request.jwt.claim.sub"='';
    do $$ begin perform public.update_my_profile('Blocked',null); raise exception 'unexpected success'; exception when insufficient_privilege then null; end $$;
    reset role;
    select test_assert(not has_function_privilege('anon','public.update_my_profile(text,text,text)','execute'),'anon denied');
    select test_assert(not has_function_privilege('anon','profile_settings_private.update_my_profile(text,text,text)','execute'),'private anon denied');
    select test_assert(not has_table_privilege('authenticated','profiles','update'),'no direct arbitrary profile updates');
  `);
  console.log('PASS: isolated DB profile save, role/tenant restrictions, email/role immutability, validation, audit, rollback and anonymous/suspended protection.');
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
