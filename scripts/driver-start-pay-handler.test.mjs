import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

// Run the actual HTTP handler, CORS, worker-token check and rate limiter. Only
// Supabase transport and the route/lease processor are mocked; no live writes.
const processorPath = new URL('../supabase/functions/_shared/driver-start-pay.ts', import.meta.url).pathname;
const bundle = await rolldown({
  input: new URL('../supabase/functions/calculate-driver-start-pay/index.ts', import.meta.url).pathname,
  plugins: [{
    name: 'isolated-driver-start-pay-handler',
    resolveId(id) {
      if (id.startsWith('https://esm.sh/@supabase/')) return '\0test-supabase';
      if (id === '../_shared/driver-start-pay.ts') return '\0test-start-pay-processor';
    },
    load(id) {
      if (id === '\0test-supabase') return 'export const createClient = (...args) => globalThis.testCreateClient(...args);';
      if (id === '\0test-start-pay-processor') return `
        export { isDriverPayWorker } from ${JSON.stringify(processorPath)};
        export const processDriverStartPay = (...args) => globalThis.testProcessDriverStartPay(...args);
      `;
    },
  }],
});
const { output } = await bundle.generate({ format: 'iife' });
await bundle.close();

const assignmentId = '11111111-1111-4111-8111-111111111111';
const otherAssignmentId = '22222222-2222-4222-8222-222222222222';
const driverId = 'driver-a';
const companyId = 'company-a';
const workerToken = 'ab'.repeat(32);
const assignment = { id: assignmentId, driver_id: driverId, company_id: companyId, status: 'active' };
const serializable = value => JSON.parse(JSON.stringify(value));

function harness({ profile = {}, assignments = [assignment], authError = null, user = { id: driverId },
  profileError = null, assignmentError = null, rateAllowed = true, rateError = null,
  processError = null, expectedToken = workerToken } = {}) {
  let handler;
  const events = [], processCalls = [], createdClients = [];
  const environment = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test-public-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', DRIVER_PAY_CRON_TOKEN: expectedToken };
  const currentProfile = profile === null ? null : { id: driverId, company_id: companyId, status: 'active', role: 'driver', ...profile };
  const admin = {
    from() { assert.fail('Caller authorization must not query through the service-role client'); },
    async rpc(name, params) {
      events.push({ type: 'service-rpc', name, params: serializable(params) });
      assert.equal(name, 'consume_edge_rate_limit');
      return { data: rateAllowed, error: rateError };
    },
  };
  const caller = {
    auth: { async getUser() { events.push({ type: 'auth' }); return { data: { user }, error: authError }; } },
    from(table) {
      assert.ok(['profiles', 'assignments'].includes(table));
      const query = { type: 'caller-query', table, filters: [] };
      return {
        select(fields) { query.fields = fields; return this; },
        eq(field, value) { query.filters.push([field, value]); return this; },
        async maybeSingle() {
          events.push(query);
          const rows = table === 'profiles' ? [currentProfile].filter(Boolean) : assignments;
          return { data: rows.find(row => query.filters.every(([field, value]) => row[field] === value)) ?? null,
            error: table === 'profiles' ? profileError : assignmentError };
        },
      };
    },
  };
  vm.runInNewContext(output[0].code, {
    Deno: { env: { get: name => environment[name] }, serve: fn => { handler = fn; } },
    Request, Response, Headers, URL, URLSearchParams, crypto, AbortSignal, TextEncoder, TextDecoder,
    console: { info() {}, error() {} },
    fetch() { assert.fail('The isolated handler test must not make network requests'); },
    testCreateClient(url, key, options) {
      assert.equal(url, environment.SUPABASE_URL);
      createdClients.push({ key, options: serializable(options) });
      if (key === environment.SUPABASE_SERVICE_ROLE_KEY) return admin;
      assert.equal(key, environment.SUPABASE_ANON_KEY);
      return caller;
    },
    async testProcessDriverStartPay(...args) {
      const [client, leaseWorkerId, requestedAssignmentId, env] = args;
      assert.equal(client, admin);
      assert.match(leaseWorkerId, /^[0-9a-f-]{36}$/i);
      assert.equal(env('SUPABASE_URL'), environment.SUPABASE_URL);
      assert.equal(args.length, 4, 'No payload coordinates, rates or money reach the processor');
      events.push({ type: 'process' });
      processCalls.push({ workerId: leaseWorkerId, assignmentId: requestedAssignmentId });
      if (processError) throw processError;
      return { claimed: 1, completed: 1, failed: 0 };
    },
  });
  return {
    events, processCalls, createdClients,
    async run({ authorization = 'Bearer driver-session', token, body = { assignmentId }, method = 'POST', rawBody } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (authorization != null) headers.Authorization = authorization;
      if (token != null) headers['X-Worker-Token'] = token;
      return handler(new Request('https://test.invalid/calculate-driver-start-pay', {
        method, headers, ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: rawBody ?? JSON.stringify(body) }),
      }));
    },
  };
}

function assertNoPrivilegedWork(h) {
  assert.equal(h.processCalls.length, 0);
  assert.equal(h.events.some(event => event.type === 'service-rpc'), false);
}

test('anonymous requests and invalid cron credentials never reach privileged work', async () => {
  for (const token of [undefined, 'wrong-token', 'ac'.repeat(32), 'test-public-key', 'test-service-key']) {
    const h = harness(); const response = await h.run({ authorization: null, token });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'Authentication required' });
    assertNoPrivilegedWork(h); assert.equal(h.events.length, 0);
  }
  for (const expectedToken of [null, '', 'bad-config-token']) {
    const h = harness({ expectedToken });
    assert.equal((await h.run({ authorization: null, token: 'bad-config-token' })).status, 401);
    assertNoPrivilegedWork(h);
  }
  const bodyToken = harness();
  assert.equal((await bodyToken.run({ authorization: null, body: { assignmentId, workerToken } })).status, 401);
  assertNoPrivilegedWork(bodyToken);
});

test('invalid sessions and inactive or non-driver profiles are rejected before assignment or service access', async () => {
  for (const config of [{ authError: { message: 'Expired token' } }, { user: null }]) {
    const h = harness(config); const response = await h.run();
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'Invalid session' });
    assert.deepEqual(h.events, [{ type: 'auth' }]); assertNoPrivilegedWork(h);
  }
  for (const profile of [null, { status: 'inactive' }, { status: 'blocked' }, { role: 'dispatcher' }, { role: 'company_admin' }]) {
    const h = harness({ profile }); const response = await h.run();
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Driver permission required' });
    assert.equal(h.events.some(event => event.table === 'assignments'), false); assertNoPrivilegedWork(h);
  }
  const h = harness({ profileError: { message: 'Private database diagnostic' } });
  assert.equal((await h.run()).status, 403); assertNoPrivilegedWork(h);
});

test('foreign, unassigned, missing and inactive assignments are blocked by caller-scoped lookup', async () => {
  for (const row of [null, { ...assignment, driver_id: 'another-driver' }, { ...assignment, company_id: 'another-company' },
    { ...assignment, driver_id: null }, { ...assignment, status: 'cancelled' }, { ...assignment, status: 'offered' }]) {
    const h = harness({ assignments: row ? [row] : [] }); const response = await h.run();
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Assignment unavailable' });
    assertNoPrivilegedWork(h);
    assert.deepEqual(h.events.find(event => event.table === 'assignments').filters,
      [['id', assignmentId], ['driver_id', driverId], ['company_id', companyId]]);
  }
  const h = harness({ assignmentError: { message: 'Secret row query error' } });
  assert.equal((await h.run()).status, 403); assertNoPrivilegedWork(h);
});

test('own driver id and company scope are verified before rate limiting and processor access', async () => {
  for (const status of ['active', 'completed']) {
    const h = harness({ assignments: [{ ...assignment, status }] }); const response = await h.run();
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { claimed: 1, completed: 1, failed: 0 });
    assert.deepEqual(h.events.map(event => event.type), ['auth', 'caller-query', 'caller-query', 'service-rpc', 'process']);
    assert.deepEqual(h.events[1], { type: 'caller-query', table: 'profiles', fields: 'id,role,status,company_id', filters: [['id', driverId]] });
    assert.deepEqual(h.events[2].filters, [['id', assignmentId], ['driver_id', driverId], ['company_id', companyId]]);
    assert.deepEqual(h.events[3], { type: 'service-rpc', name: 'consume_edge_rate_limit', params: {
      scope: 'calculate-driver-start-pay', actor: driverId, limit_count: 30, window_seconds: 300,
    } });
    assert.equal(h.processCalls[0].assignmentId, assignmentId);
    assert.deepEqual(h.createdClients, [
      { key: 'test-service-key', options: { auth: { autoRefreshToken: false, persistSession: false } } },
      { key: 'test-public-key', options: { global: { headers: { Authorization: 'Bearer driver-session' } } } },
    ]);
  }
});

test('the dedicated worker token admits a bounded worker batch without caller auth or assignment override', async () => {
  const h = harness({ user: null, profile: null, assignments: [] });
  const response = await h.run({ authorization: null, token: workerToken, body: { assignmentId: otherAssignmentId } });
  assert.equal(response.status, 200);
  assert.deepEqual(h.events, [{ type: 'process' }]);
  assert.equal(h.processCalls.length, 1); assert.equal(h.processCalls[0].assignmentId, null);
  assert.equal(h.createdClients.length, 1); assert.equal(h.createdClients[0].key, 'test-service-key');
});

test('caller-controlled coordinates, route, driver, rate and money cannot affect processor arguments', async () => {
  const h = harness(); const response = await h.run({ body: {
    assignmentId, driverId: 'another-driver', companyId: 'another-company',
    origin: { latitude: 1, longitude: 2 }, latitude: 3, longitude: 4,
    locationAt: '2099-01-01T00:00:00Z', stops: [{ latitude: 5, longitude: 6 }],
    loadedMiles: 1, deadheadMiles: 0, rate: 100, ratePerMile: 100, amount: 1, worker: true,
  } });
  assert.equal(response.status, 200); assert.equal(h.processCalls.length, 1);
  assert.equal(h.processCalls[0].assignmentId, assignmentId);
  assert.deepEqual(h.events[2].filters, [['id', assignmentId], ['driver_id', driverId], ['company_id', companyId]]);
});

test('malformed assignment and payload are rejected without privileged work', async () => {
  for (const body of [{}, { assignmentId: 'not-a-uuid' }, { assignmentId: 42 }, null, [], 'text']) {
    const h = harness(); assert.equal((await h.run({ body })).status, 400); assertNoPrivilegedWork(h);
  }
  const invalidJson = harness(); assert.equal((await invalidJson.run({ rawBody: '{' })).status, 400); assertNoPrivilegedWork(invalidJson);
  const wrongMethod = harness(); assert.equal((await wrongMethod.run({ method: 'GET' })).status, 405); assertNoPrivilegedWork(wrongMethod);
});

test('rate limits block calculation and service failures never leak provider diagnostics', async () => {
  const limited = harness({ rateAllowed: false }); const limitedResponse = await limited.run();
  assert.equal(limitedResponse.status, 429); assert.equal(limited.processCalls.length, 0);
  const failedLimit = harness({ rateError: { message: 'secret rate-limit diagnostic' } });
  const rateResponse = await failedLimit.run();
  assert.equal(rateResponse.status, 503); assert.equal(failedLimit.processCalls.length, 0);
  assert.deepEqual(await rateResponse.json(), { error: 'Rate limit service is temporarily unavailable.' });
  const secretMessage = 'https://provider.invalid/route?access_token=secret-provider-token internal SQL';
  for (const worker of [false, true]) {
    const h = harness({ processError: new Error(secretMessage) });
    const response = await h.run(worker ? { authorization: null, token: workerToken } : {});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Mileage calculation is pending; it will retry automatically.' });
  }
});
