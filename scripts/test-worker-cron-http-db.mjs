import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Private Unix-socket cluster only; never loads application or cloud credentials.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'drivex-http-test-'));
const pgBin = process.env.PG_BIN || '';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const port = '55441';
const projectUrl = 'https://12345678901234567890.supabase.co';
const tokens = { push: 'a'.repeat(64), media: 'b'.repeat(64) };
const literal = (value) => value === null ? 'null' : `'${value.replaceAll("'", "''")}'`;
function run(binary, args, input) {
  const result = spawnSync(path.join(pgBin, binary), args, { cwd: root, env, input, encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
}
function checked(binary, args, input) {
  const result = run(binary, args, input);
  assert.equal(result.status, 0, `${binary} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function sql(statement, expectFailure = false) {
  const args = ['-X', '--no-password', '-h', directory, '-p', port, '-U', 'test_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atq', '-f', '-'];
  return expectFailure ? run('psql', args, statement) : checked('psql', args, statement);
}
const json = (statement) => JSON.parse(sql(statement));
const invoke = (worker) => sql(`set role postgres; select worker_cron.invoke(${literal(worker)});`);
const monitor = (worker) => json(`select row_to_json(i) from worker_cron.last_invocations i where worker = '${worker}';`);
function setSecret(name, value) {
  sql(`delete from vault.decrypted_secrets where name = ${literal(name)};
    insert into vault.decrypted_secrets values (${literal(name)}, ${literal(value)});`);
}
function attempts() {
  return sql(`select jsonb_build_object(
    'http', (select jsonb_build_array(last_value,is_called) from test_support.http_attempts),
    'net', (select jsonb_build_array(last_value,is_called) from net.test_request_ids));`);
}
function reject(worker, expected) {
  const before = attempts();
  const stored = sql('select jsonb_agg(to_jsonb(i) order by worker) from worker_cron.last_invocations i;');
  const result = sql(`set role postgres; select worker_cron.invoke(${literal(worker)});`, true);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(expected), result.stderr);
  assert.equal(attempts(), before, 'Rejected configuration cannot attempt either HTTP transport, even before rollback');
  assert.equal(sql('select jsonb_agg(to_jsonb(i) order by worker) from worker_cron.last_invocations i;'), stored);
}

let started = false;
try {
  checked('initdb', ['-D', `${directory}/data`, '-U', 'test_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  checked('pg_ctl', ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p ${port}`, '-w', 'start']);
  started = true;
  sql(`
    create role postgres nologin;
    create role supabase_admin nologin;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant create on database postgres to postgres;
    create schema vault;
    create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
    grant usage on schema vault to postgres;
    grant select on vault.decrypted_secrets to postgres;
    create schema net authorization supabase_admin;
    create sequence net.test_request_ids;
    alter sequence net.test_request_ids owner to supabase_admin;
    create table net.test_requests(headers jsonb);
    alter table net.test_requests owner to supabase_admin;
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
      headers jsonb default '{}', timeout_milliseconds integer default 2000)
    returns bigint language plpgsql as $$
    begin
      perform nextval('net.test_request_ids');
      raise exception 'pg_net must never be called';
    end;
    $$;
    alter function net.http_post(text,jsonb,jsonb,jsonb,integer) owner to supabase_admin;
    grant usage on schema net to public;
    grant all on all tables in schema net to public;
    grant all on all sequences in schema net to public;
    grant execute on all functions in schema net to public;
    create schema extensions;
    grant usage on schema extensions to postgres;
    -- Model USERSET timeouts without the C extension. TLS controls deliberately
    -- remain superuser-only, matching pgsql-http's PGC_SUSET controls.
    grant set on parameter "http.curlopt_timeout_ms", "http.curlopt_connecttimeout_ms" to postgres;
    create type extensions.http_method as enum ('POST');
    create type extensions.http_header as (field varchar, value varchar);
    create type extensions.http_request as (
      method extensions.http_method, uri varchar, headers extensions.http_header[], content_type varchar, content varchar
    );
    create type extensions.http_response as (
      status integer, content_type varchar, headers extensions.http_header[], content varchar
    );
    create schema test_support;
    create sequence test_support.http_attempts;
    create table test_support.requests(id bigint, request jsonb, timeout_ms text, connect_timeout_ms text, verify_host text, verify_peer text);
    create table test_support.response(status integer, content text, fail boolean);
    insert into test_support.response values (200, '{}', false);
    create function extensions.http_list_curlopt() returns table(curlopt text, value text)
    language plpgsql security definer set search_path = '' as $$
    begin
      perform set_config('test_support.http_loaded', 'true', true);
      return;
    end;
    $$;
    create function extensions.http(request extensions.http_request) returns extensions.http_response
    language plpgsql security definer set search_path = '' as $$
    declare
      attempt bigint := nextval('test_support.http_attempts');
      response test_support.response;
    begin
      if current_setting('test_support.http_loaded', true) is distinct from 'true' then
        raise exception 'HTTP extension must be loaded before the request';
      end if;
      insert into test_support.requests values (attempt, to_jsonb(request),
        current_setting('http.curlopt_timeout_ms'), current_setting('http.curlopt_connecttimeout_ms'),
        current_setting('http.curlopt_ssl_verifyhost', true), current_setting('http.curlopt_ssl_verifypeer', true));
      select * into response from test_support.response;
      if response.fail then
        raise exception 'Provider error leaking token % and URL %', (request.headers[1]).value, request.uri;
      end if;
      return row(response.status, 'application/json',
        array[row('Private-Provider-Header','do-not-store')::extensions.http_header], response.content)::extensions.http_response;
    end;
    $$;
  `);
  for (const [filename, extension] of [
    ['20261005010547_schedule_chat_workers.sql', 'pg_net'],
    ['20261005010711_restrict_worker_cron_transport.sql', null],
    ['20261005011922_invoke_chat_workers_without_public_queue.sql', 'http'],
  ]) {
    let migration = await readFile(path.join(root, 'supabase/migrations', filename), 'utf8');
    if (extension) {
      const declaration = new RegExp(`^create extension if not exists ${extension} with schema extensions;\\r?$`, 'gm');
      assert.equal([...migration.matchAll(declaration)].length, 1);
      migration = migration.replace(declaration, '');
    }
    sql(`set role postgres; ${migration}`);
  }
  const lifecycleMigration = await readFile(path.join(root, 'supabase/migrations/20261005120609_chat_upload_lifecycle_and_worker_capacity.sql'), 'utf8');
  const capacityOffset = lifecycleMigration.indexOf('\ndo $$\ndeclare definition text;');
  assert.ok(capacityOffset > 0, 'capacity migration block must be present');
  sql(`set role postgres; ${lifecycleMigration.slice(capacityOffset)}`);
  assert.equal(sql("select has_table_privilege('anon','net.test_requests','SELECT');"), 't',
    'Managed net ownership must reproduce ineffective REVOKEs: this test does not claim pg_net ACLs are fixed');
  const security = json(`select json_build_object('definer',prosecdef,'config',proconfig)
    from pg_proc where oid='worker_cron.invoke(text)'::regprocedure;`);
  assert.equal(security.definer, false);
  assert.deepEqual(security.config, ['search_path=""'], 'Curl settings must be applied after loading the extension, not at function creation');
  assert.equal(sql("select relrowsecurity from pg_class where oid='worker_cron.last_invocations'::regclass;"), 't');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.deepEqual(json(`select json_build_array(
      has_schema_privilege('${role}','worker_cron','USAGE,CREATE'),
      has_table_privilege('${role}','worker_cron.last_invocations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      has_function_privilege('${role}','worker_cron.invoke(text)','EXECUTE'));`), [false, false, false]);
    for (const statement of ['select * from worker_cron.last_invocations', "select worker_cron.invoke('push')"]) {
      const result = sql(`set role ${role}; ${statement};`, true);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /permission denied/);
    }
  }
  console.log('PASS: realistic managed net ownership, non-superuser postgres, private worker ACLs and secure HTTP settings');

  const privateResponse = {
    claimed: 3, completed: 2, failed: 1, cancelled: 0, transitionFailures: 0, deadlineReached: false,
    maintenance: { expiredUploads: 1, staleJobs: 2, expiredRateLimits: 3, staleCalls: 4, expiredChatUploads: 5, token: tokens.push, detail: 'do-not-store' },
    token: tokens.push, url: projectUrl, error: 'do-not-store', headers: { secret: tokens.media },
  };
  const expectedSummary = {
    claimed: 3, completed: 2, failed: 1, cancelled: 0, transitionFailures: 0, deadlineReached: false,
    maintenance: { expiredUploads: 1, staleJobs: 2, expiredRateLimits: 3, staleCalls: 4, expiredChatUploads: 5 },
  };
  sql(`update test_support.response set content=${literal(JSON.stringify(privateResponse))};`);
  setSecret('chat_cron_project_url', projectUrl);
  for (const worker of ['push', 'media']) setSecret(`chat_${worker}_cron_token`, tokens[worker]);
  for (const [worker, endpoint] of [['push', 'process-push-notifications'], ['media', 'process-media-deletions']]) {
    const invocationId = invoke(worker);
    const record = monitor(worker);
    assert.equal(String(record.request_id), invocationId);
    assert.equal(record.http_status, 200);
    assert.deepEqual(record.response_summary, expectedSummary);
    assert.ok(Date.parse(record.completed_at) >= Date.parse(record.requested_at));
    const captured = json('select row_to_json(r) from test_support.requests r order by id desc limit 1;');
    assert.deepEqual(captured.request, {
      method: 'POST', uri: `${projectUrl}/functions/v1/${endpoint}`, headers: [{ field: 'X-Worker-Token', value: tokens[worker] }],
      content_type: 'application/json', content: '{"batchSize":30}',
    });
    assert.deepEqual([captured.timeout_ms, captured.connect_timeout_ms, captured.verify_host, captured.verify_peer], ['55000','10000',null,null]);
  }
  console.log('PASS: both workers use only synchronous POST with dedicated tokens, 55s timeout and whitelisted monitoring');

  for (const option of ['http.curlopt_ssl_verifyhost', 'http.curlopt_ssl_verifypeer']) {
    const before = attempts();
    // Only test_admin disables TLS. The actual helper runs as non-superuser postgres.
    sql(`begin; select set_config('${option}', '0', true);
      set local role postgres; select worker_cron.invoke('push'); commit;`);
    assert.equal(monitor('push').http_status, 0);
    assert.deepEqual(monitor('push').response_summary, { transportError: true });
    assert.equal(attempts(), before, 'Disabled TLS must fail closed before any HTTP attempt');
  }
  console.log('PASS: disabled TLS host or peer verification fails closed with no HTTP request');

  const priorPush = monitor('push');
  const rotated = 'c'.repeat(64);
  setSecret('chat_push_cron_token', rotated);
  invoke('push');
  assert.equal(sql("select request->'headers'->0->>'value' from test_support.requests order by id desc limit 1;"), rotated);
  assert.notEqual(monitor('push').request_id, priorPush.request_id);
  sql(`update test_support.response set status=503, content=${literal(JSON.stringify({ claimed: tokens.push,
    completed: '2', failed: 1, deadlineReached: tokens.media, maintenance: { staleJobs: tokens.push, staleCalls: 2 }, error: tokens.media }))};`);
  invoke('media');
  assert.equal(monitor('media').http_status, 503);
  assert.deepEqual(monitor('media').response_summary, { failed: 1, maintenance: { staleCalls: 2 } });
  for (const content of [`not-json ${tokens.push}`, '[]', '"do-not-store"']) {
    sql(`update test_support.response set content=${literal(content)};`);
    invoke('push');
    assert.deepEqual(monitor('push').response_summary, { invalidResponse: true });
  }
  sql('update test_support.response set fail=true;');
  invoke('media');
  assert.equal(monitor('media').http_status, 0);
  assert.deepEqual(monitor('media').response_summary, { transportError: true });
  assert.equal(Number(sql('select count(*) from worker_cron.last_invocations;')), 2);
  const stored = sql('select jsonb_agg(to_jsonb(i)) from worker_cron.last_invocations i;');
  for (const sensitive of [...Object.values(tokens), rotated, projectUrl, 'do-not-store', 'Provider error']) {
    assert.equal(stored.includes(sensitive), false, 'Raw response/error/token must not persist');
  }
  console.log('PASS: rotated tokens, bounded upserts, HTTP error status, malformed payloads and transport errors never persist secrets');

  sql("delete from vault.decrypted_secrets where name='chat_cron_project_url';");
  reject('push', 'Cron project URL is missing or invalid');
  for (const value of [null, '', 'http://12345678901234567890.supabase.co', `${projectUrl}.evil.example`, `${projectUrl}/`, `${projectUrl}\n`]) {
    setSecret('chat_cron_project_url', value);
    for (const worker of ['push', 'media']) reject(worker, 'Cron project URL is missing or invalid');
  }
  setSecret('chat_cron_project_url', projectUrl);
  for (const worker of ['push', 'media']) {
    sql(`delete from vault.decrypted_secrets where name='chat_${worker}_cron_token';`);
    reject(worker, 'Cron worker token is missing or invalid');
    for (const value of [null, '', 'a'.repeat(63), 'a'.repeat(65), 'G'.repeat(64), `${tokens[worker]}\n`]) {
      setSecret(`chat_${worker}_cron_token`, value);
      reject(worker, 'Cron worker token is missing or invalid');
    }
    setSecret(`chat_${worker}_cron_token`, tokens[worker]);
  }
  for (const worker of [null, '', 'unknown', 'PUSH']) reject(worker, 'Unknown scheduled worker');
  assert.equal(sql('select is_called from net.test_request_ids;'), 'f', 'Final helper never invokes pg_net, including on HTTP errors');
  assert.equal(sql('select count(*) from net.test_requests;'), '0', 'No request headers enter the public pg_net queue');
  console.log('PASS: invalid configuration has no HTTP side effects; pg_net was never called in any success or failure case');
  const documentMigration = await readFile(path.join(root, 'supabase/migrations/20261007003612_durable_document_check_worker.sql'), 'utf8');
  const documentCronOffset = documentMigration.indexOf('-- Preserve the existing credential-safe synchronous transport.');
  assert.ok(documentCronOffset > 0);
  sql(`set role postgres; ${documentMigration.slice(documentCronOffset)}`);
  reject('document', 'Cron worker token is missing or invalid');
  setSecret('document_check_cron_token', 'd'.repeat(64));
  sql(`update test_support.response set fail=false,status=200,content='{"claimed":1,"completed":1}';`);
  invoke('document');
  assert.equal(sql("select request->>'uri' from test_support.requests order by id desc limit 1;"), `${projectUrl}/functions/v1/check-load-document`);
  assert.equal(sql("select request->'headers'->0->>'value' from test_support.requests order by id desc limit 1;"), 'd'.repeat(64));
  assert.deepEqual(monitor('document').response_summary, { claimed: 1, completed: 1 });
  assert.equal(sql("select has_function_privilege('authenticated','worker_cron.invoke(text)','EXECUTE');"), 'f');
  console.log('PASS: document consumer extends credential-safe Cron transport with its own token and retains private ACLs');
  console.log('PASS: isolated synchronous worker Cron migration checks');
} finally {
  if (started) checked('pg_ctl', ['-D', `${directory}/data`, '-m', 'fast', '-w', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
