import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic, isolated PostgreSQL only: no project credentials or real data.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'rate-con-privacy-'));
const binary = process.env.PG_BIN || '/usr/lib/postgresql/18/bin';
function run(name, args, input) {
  const result = spawnSync(path.join(binary, name), args,
    { input, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  return result.stdout;
}
const sql = text => run('psql', ['-h', directory, '-p', '55442', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], text);
async function productionFunction(file, name) {
  const source = await readFile(path.join(root, 'supabase/migrations', file), 'utf8');
  const position = source.indexOf(`function ${name}(`);
  assert(position >= 0, name);
  return source.slice(source.lastIndexOf('create ', position), source.indexOf('$$;', position) + 3);
}
let started = false;
try {
  run('initdb', ['-D', `${directory}/data`, '-A', 'trust', '--no-locale']);
  run('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 55442`, 'start']);
  started = true;
  sql(`create role authenticated; create schema auth; create schema private; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key,company_id uuid,role text,status text);
    create table loads(id uuid primary key,company_id uuid,trashed_at timestamptz);
    create table assignments(id uuid primary key,load_id uuid,driver_id uuid,assigned_at timestamptz default now());
    create table driver_pay_settings(driver_id uuid primary key,hide_rate_con boolean);
    create table assignment_driver_pay(assignment_id uuid);
    create table assignment_driver_pay_pending(assignment_id uuid);
    create table documents(id uuid primary key,company_id uuid,load_id uuid,document_type text,current_version_id uuid,removed_at timestamptz);
    create table document_versions(id uuid primary key,document_id uuid,storage_path text,uploaded_by uuid,upload_lease_started_at timestamptz,upload_expires_at timestamptz,superseded_at timestamptz);
    create type document_check_status as enum('passed');
    create table document_checks(id uuid,company_id uuid,document_version_id uuid,status document_check_status,confidence numeric,model_name text,result jsonb,checked_at timestamptz);
    create table storage.objects(name text);
    create function current_app_role() returns text language sql stable security definer as $$select role from public.profiles where id=auth.uid()$$;
    create function can_access_load(target uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.assignments a join public.profiles p on p.id=a.driver_id join public.loads l on l.id=a.load_id
        where a.driver_id=auth.uid() and a.load_id=target and p.company_id=l.company_id and p.status='active')$$;
    create function test_assert(ok boolean,message text) returns void language plpgsql as $$begin
      if ok is distinct from true then raise exception '%',message; end if; end$$;
    insert into profiles values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','driver','active');
    insert into loads values('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000020',null);
    insert into assignments(id,load_id,driver_id) values('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000001');
    insert into driver_pay_settings values('00000000-0000-0000-0000-000000000001',true);
    insert into documents values
      ('00000000-0000-0000-0000-000000000200','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000100','rate_confirmation','00000000-0000-0000-0000-000000000210',null),
      ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000100','receipt','00000000-0000-0000-0000-000000000211',null);
    insert into document_versions(id,document_id,storage_path) values
      ('00000000-0000-0000-0000-000000000210','00000000-0000-0000-0000-000000000200','rate-current'),
      ('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000201','receipt-current'),
      ('00000000-0000-0000-0000-000000000212','00000000-0000-0000-0000-000000000201','receipt-old');
    insert into document_checks values('00000000-0000-0000-0000-000000000220','00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000211','passed',1,'fixture','{"brokerRate":9999}',now());
    insert into storage.objects values('rate-current'),('receipt-current'),('receipt-old');
    grant usage on schema auth,private,storage to authenticated;
    grant select on all tables in schema public,storage to authenticated;`);
  sql(await productionFunction('20261008092404_assignment_driver_pay_pending.sql', 'private.hide_broker_terms'));
  sql(await productionFunction('20261008172549_staff_load_document_management.sql', 'private.hidden_driver_pay_file'));
  sql(await productionFunction('20261008172549_staff_load_document_management.sql', 'private.driver_document_file_visible'));
  sql(await productionFunction('20261007003622_private_document_check_projection.sql', 'private.document_review_checks'));
  sql(`alter table documents enable row level security; alter table document_versions enable row level security;
    alter table storage.objects enable row level security;
    create policy scoped_docs on documents for select to authenticated using(can_access_load(load_id));
    create policy documents_driver_pay_privacy on documents as restrictive for select to authenticated
      using(document_type not in ('rate_confirmation','receipt') or not private.hide_broker_terms(load_id));
    create policy scoped_versions on document_versions for select to authenticated
      using(exists(select 1 from documents d where d.id=document_id));
    create policy versions_driver_pay_privacy on document_versions as restrictive for select to authenticated
      using(not private.hidden_driver_pay_file(storage_path));
    create policy scoped_storage on storage.objects for select to authenticated using(private.driver_document_file_visible(name,null));
    create policy storage_driver_pay_privacy on storage.objects as restrictive for select to authenticated
      using(not private.hidden_driver_pay_file(name));`);
  sql(await readFile(path.join(root, 'supabase/migrations/20261013205744_rate_con_visibility_keep_receipts.sql'), 'utf8'));
  const driver = `set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';`;
  const hiddenChecks = `select test_assert((select count(*)=1 from documents),'only receipt remains visible');
    select test_assert((select count(*)=1 from document_versions),'only current receipt version remains');
    select test_assert((select count(*)=1 from storage.objects),'receipt is readable; Rate Con and stale version denied');
    select test_assert((select status='passed' and result is null from private.document_review_checks('00000000-0000-0000-0000-000000000201')),'receipt safe status survives; raw broker JSON stays private');`;
  sql(`${driver} ${hiddenChecks} reset role;`);
  for (let cycle = 0; cycle < 3; cycle++) {
    sql(`update driver_pay_settings set hide_rate_con=false; ${driver}
      select test_assert((select count(*)=2 from documents),'unhide restores Rate Con metadata');
      select test_assert((select count(*)=2 from storage.objects),'unhide restores Rate Con file signing');
      reset role; update driver_pay_settings set hide_rate_con=true; ${driver} ${hiddenChecks} reset role;`);
  }
  sql(`update driver_pay_settings set hide_rate_con=false;
    insert into assignment_driver_pay_pending values('00000000-0000-0000-0000-000000000101');
    ${driver} ${hiddenChecks} reset role;
    delete from assignment_driver_pay_pending;
    insert into assignment_driver_pay values('00000000-0000-0000-0000-000000000101');
    ${driver} ${hiddenChecks} reset role;
    update documents set removed_at=now() where document_type='receipt';
    ${driver} select test_assert(not private.driver_document_file_visible('receipt-current',null),'removed receipt is still denied');
    reset role;
    insert into profiles values('00000000-0000-0000-0000-000000000999','00000000-0000-0000-0000-000000000021','driver','active');
    set role authenticated; set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000999';
    select test_assert(not exists(select 1 from documents),'another driver sees no documents');
    select test_assert(not exists(select 1 from storage.objects),'another driver sees no files'); reset role;`);
  console.log('PASS: hidden receipts remain available, Rate Con toggles restore metadata/files, fixed pay and tenant/current-version boundaries remain enforced');
} finally {
  if (started) run('pg_ctl', ['-D', `${directory}/data`, '-m', 'immediate', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
