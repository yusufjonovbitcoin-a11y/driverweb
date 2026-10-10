import test from 'node:test';
import assert from 'node:assert/strict';
import { createGmailSyncHandler } from '../supabase/functions/gmail-sync-worker/handler.mjs';

const companyId = '00000000-0000-4000-8000-000000000001';
const connectionId = '00000000-0000-4000-8000-000000000002';
const owner = '00000000-0000-4000-8000-000000000003';
const serverKey = 'test-only-service-key';
const claim = { status: 'claimed', connection_id: connectionId, configuration_version: 3, provider_history_id: '42' };
const request = (body = { companyId, action: 'run' }, token = serverKey, method = 'POST') => new Request('https://example.invalid/worker', {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});

function harness({ enabled, claimValue = claim, claimError, runtimeError, importError, releaseError, companyEnabled = false, secretKeys } = {}) {
  const events = [];
  const env = { SUPABASE_SERVICE_ROLE_KEY: serverKey, SUPABASE_URL: 'https://example.invalid', GMAIL_WORKER_TOKEN: 'test-worker-token', GMAIL_CLOUD_WORKER_ENABLED: enabled };
  env.SUPABASE_SECRET_KEYS = secretKeys;
  const admin = {
    rpc: async (name, args) => {
      events.push({ name, args });
      return name === 'claim_gmail_cloud_worker'
        ? { data: claimValue, error: claimError }
        : { data: { status: 'released' }, error: releaseError };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { enabled: companyEnabled } }) }) }) }),
  };
  const handle = createGmailSyncHandler({
    env: name => env[name], randomUUID: () => owner,
    logger: { error: message => events.push({ name: 'log', message }) },
    createAdmin: () => { events.push({ name: 'admin' }); return admin; },
    loadRuntime: async () => {
      events.push({ name: 'import' });
      if (importError) throw importError;
      return { dependencies: {}, runGmailSync: async (config) => {
        events.push({ name: 'run', companyId: config.companyId, connectionId: config.connection.id });
        if (runtimeError) throw runtimeError;
        return { synced: 1 };
      } };
    },
  });
  return { handle, events };
}

test('default paused run/status never creates a client, loads credentials, or imports runtime', async () => {
  for (const action of ['run', 'status']) {
    const { handle, events } = harness();
    const response = await handle(request({ companyId, action }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'paused', reason: 'deployment_disabled', executed: false });
    assert.deepEqual(events, []);
  }
});

test('only exact true enables global gate; no truthy-string bypass', async () => {
  for (const enabled of ['TRUE', '1', 'yes', 'false', 'true ', '']) {
    const { handle, events } = harness({ enabled });
    assert.equal((await (await handle(request())).json()).status, 'paused');
    assert.deepEqual(events, []);
  }
});

test('missing, forged, anon and user credentials are rejected before any work', async () => {
  for (const token of ['', 'anon-jwt', 'user-jwt', `${serverKey}x`, 'Bearer']) {
    const { handle, events } = harness({ enabled: 'true' });
    assert.equal((await handle(request(undefined, token))).status, 401);
    assert.deepEqual(events, []);
  }
});

test('modern server key is checked exactly on apikey, not trusted from bearer claims', async () => {
  for (const [apiKey, expected] of [['sb_secret_fixture', 200], ['sb_secret_forged', 401], ['sb_publishable_fixture', 401], ['', 401]]) {
    const { handle, events } = harness({ secretKeys: JSON.stringify({ default: 'sb_secret_fixture' }) });
    const req = request(undefined, 'untrusted-user-jwt');
    req.headers.set('apikey', apiKey);
    const response = await handle(req);
    assert.equal(response.status, expected);
    if (expected === 200) assert.equal((await response.json()).status, 'paused');
    assert.deepEqual(events, []);
  }
});

test('malformed or public runtime key maps fail closed', async () => {
  for (const secretKeys of ['{broken', 'null', '[]', '{"default":"sb_publishable_fixture"}', '{"default":123}']) {
    const { handle, events } = harness({ secretKeys });
    const req = request(undefined, 'untrusted');
    req.headers.set('apikey', 'sb_publishable_fixture');
    assert.equal((await handle(req)).status, 401);
    assert.deepEqual(events, []);
  }
});

test('method, oversized body, unknown fields/actions and company IDs cannot bypass gates', async () => {
  const { handle, events } = harness({ enabled: 'true' });
  assert.equal((await handle(request(undefined, serverKey, 'GET'))).status, 405);
  for (const body of [null, [], {}, { companyId: 'bad', action: 'run' }, { companyId: { toString: 'bad' } }, { companyId, action: 'enable' }, { companyId, action: 'run', enabled: true }, { companyId, action: 'x'.repeat(4096) }]) {
    assert.equal((await handle(request(body))).status, 400);
  }
  assert.deepEqual(events, []);
});

test('company pause, occupied lease and unavailable connection never import runtime', async () => {
  for (const status of ['paused', 'busy', 'unavailable']) {
    const { handle, events } = harness({ enabled: 'true', claimValue: { status } });
    const response = await handle(request());
    assert.deepEqual(await response.json(), { status, executed: false });
    assert.deepEqual(events.map(e => e.name), ['admin', 'claim_gmail_cloud_worker']);
  }
});

test('status is read-only and does not claim or run even when globally enabled', async () => {
  const { handle, events } = harness({ enabled: 'true', companyEnabled: true });
  assert.deepEqual(await (await handle(request({ companyId, action: 'status' }))).json(), { status: 'enabled', executed: false });
  assert.deepEqual(events.map(e => e.name), ['admin']);
});

test('successful claimed run always releases the exact owned lease', async () => {
  const { handle, events } = harness({ enabled: 'true' });
  assert.equal((await handle(request())).status, 200);
  assert.deepEqual(events.map(e => e.name), ['admin', 'claim_gmail_cloud_worker', 'import', 'run', 'release_gmail_cloud_worker']);
  assert.deepEqual(events.at(-1).args, { p_company_id: companyId, p_owner: owner, p_connection_id: connectionId, p_configuration_version: 3 });
});

test('import/runtime failures release lease and redact provider messages', async () => {
  for (const failure of ['importError', 'runtimeError']) {
    const { handle, events } = harness({ enabled: 'true', [failure]: new Error('secret email body and access_token') });
    const response = await handle(request());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'worker_failed');
    assert.equal(events.at(-1).name, 'release_gmail_cloud_worker');
    assert.doesNotMatch(JSON.stringify(events), /secret email|access_token/);
  }
});

test('failed claim does not release another owner; cleanup failure is not reported as success', async () => {
  const failed = harness({ enabled: 'true', claimError: new Error('db') });
  assert.equal((await failed.handle(request())).status, 500);
  assert.ok(!failed.events.some(e => e.name === 'release_gmail_cloud_worker'));
  const cleanup = harness({ enabled: 'true', releaseError: new Error('db') });
  assert.equal((await cleanup.handle(request())).status, 500);
});
