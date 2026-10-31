import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { withIsolatedPostgres } from './isolated-postgres.mjs';

// All rows and the Vault adapter below belong to a disposable local database.
// Production uses Supabase Vault's authenticated encryption, not this test adapter.
await withIsolatedPostgres(async ({ sql }) => {
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create schema vault; create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid references companies(id) on delete cascade,role text,status text);
    create table auth.users(id uuid primary key,encrypted_password text);
    create table audit_events(company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
    create table vault.secrets(id uuid primary key default gen_random_uuid(),secret bytea not null);
    create function vault.create_secret(new_secret text,new_name text default null,new_description text default '',new_key_id uuid default null)
    returns uuid language plpgsql as $$declare value uuid; begin
      insert into vault.secrets(secret) values(extensions.pgp_sym_encrypt(new_secret,'fixture-only-key')) returning id into value; return value; end;$$;
    create view vault.decrypted_secrets as select id,extensions.pgp_sym_decrypt(secret,'fixture-only-key') decrypted_secret from vault.secrets;
    revoke all on vault.secrets,vault.decrypted_secrets from public,anon,authenticated;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into companies values('11111111-1111-4111-8111-111111111111'),('99999999-9999-4999-8999-999999999999');
    insert into profiles values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','company_admin','active'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','driver','active'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','99999999-9999-4999-8999-999999999999','company_admin','active'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','dispatcher','active');
    insert into auth.users values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',extensions.crypt('Fixture-only-password',extensions.gen_salt('bf',4)));`);
  sql(await readFile('supabase/migrations/20261026085439_driver_password_vault.sql', 'utf8'));
  const actor = `'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`, driver = `'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`;
  const service = `set role service_role;set "request.jwt.claim.role"='service_role';`;
  const store = `select public.store_driver_password_secret(${actor},${driver},'Fixture-only-password');`;
  const status = `select public.read_driver_password_secret(${actor},${driver},false);`;
  const reveal = `select public.read_driver_password_secret(${actor},${driver},true);`;
  for (const role of ['anon','authenticated']) {
    assert.throws(() => sql(`set role ${role};${store}`), /permission denied/);
    assert.throws(() => sql(`set role ${role};${reveal}`), /permission denied/);
    assert.throws(() => sql(`set role ${role};select * from private.driver_password_secrets;`), /permission denied/);
    assert.throws(() => sql(`set role ${role};select * from vault.decrypted_secrets;`), /permission denied/);
  }
  assert.equal(JSON.parse(sql(service + status)).available, false);
  assert.equal(sql(service + store).trim(), 't');
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '1');
  assert.equal(sql(`select position(convert_to('Fixture-only-password','utf8') in secret)=0 from vault.secrets;`).trim(), 't');
  assert.equal(JSON.parse(sql(service + status)).password, undefined);
  assert.equal(JSON.parse(sql(service + reveal)).password, 'Fixture-only-password');
  assert.equal(sql(`select count(*) from audit_events where action='driver.password_viewed';`).trim(), '1');
  assert.equal(sql(`select count(*) from audit_events where metadata::text like '%Fixture-only-password%';`).trim(), '0');
  sql(`alter table audit_events add constraint reject_view_audit check (action <> 'driver.password_viewed') not valid;`);
  assert.throws(() => sql(service + reveal), /reject_view_audit/);
  sql(`alter table audit_events drop constraint reject_view_audit;`);
  for (const wrongActor of ['cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd']) {
    assert.throws(() => sql(service + `select public.read_driver_password_secret('${wrongActor}',${driver},true);`), /FORBIDDEN/);
  }
  sql(`update profiles set status='suspended' where id=${driver};`);
  assert.equal(JSON.parse(sql(service + reveal)).available, true);
  sql(`update auth.users set encrypted_password=extensions.crypt('Different-fixture-password',extensions.gen_salt('bf',4)) where id=${driver};`);
  assert.equal(JSON.parse(sql(service + status)).available, false);
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '0');
  assert.equal(sql(service + store).trim(), 'f'); // A racing/obsolete value cannot be archived.
  sql(`update auth.users set encrypted_password=extensions.crypt('Fixture-only-password',extensions.gen_salt('bf',4)) where id=${driver};`);
  assert.equal(sql(service + store).trim(), 't');
  sql(`update profiles set company_id='99999999-9999-4999-8999-999999999999' where id=${driver};`);
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '0');
  sql(`update profiles set company_id='11111111-1111-4111-8111-111111111111' where id=${driver};`);
  assert.equal(sql(service + store).trim(), 't');
  sql(`delete from profiles where id=${driver};`);
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '0');
  assert.equal(sql('select count(*) from private.driver_password_secrets;').trim(), '0');
  sql(`insert into profiles values(${driver},'11111111-1111-4111-8111-111111111111','driver','active');`);
  assert.equal(sql(service + store).trim(), 't');
  sql(`alter table auth.users disable trigger invalidate_driver_auth_password_secret;
    update auth.users set encrypted_password=extensions.crypt('Another-fixture-password',extensions.gen_salt('bf',4)) where id=${driver};
    alter table auth.users enable trigger invalidate_driver_auth_password_secret;`);
  assert.equal(JSON.parse(sql(service + status)).available, false);
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '0');
  sql(`update auth.users set encrypted_password=extensions.crypt('Fixture-only-password',extensions.gen_salt('bf',4)) where id=${driver};`);
  assert.equal(sql(service + store).trim(), 't');
  sql(`delete from companies where id='11111111-1111-4111-8111-111111111111';`);
  assert.equal(sql('select count(*) from vault.secrets;').trim(), '0');
  console.log('PASS: encrypted storage, role/tenant isolation, audited explicit reads, current-password matching and automatic cleanup');
}, { port: 55453 });
