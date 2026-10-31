import test from 'node:test';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

const bundle = await rolldown({ input: 'supabase/functions/update-driver-password/handler.ts' });
const { output } = await bundle.generate({ format: 'es', codeSplitting: false });
await bundle.close();
const { handleDriverPassword } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
const readBundle = await rolldown({ input: 'supabase/functions/read-driver-password/handler.ts' });
const readOutput = await readBundle.generate({ format: 'es', codeSplitting: false });
await readBundle.close();
const { handleReadDriverPassword } = await import(`data:text/javascript;base64,${Buffer.from(readOutput.output[0].code).toString('base64')}`);
const actorId = '11111111-1111-4111-8111-111111111111';
const driverId = '22222222-2222-4222-8222-222222222222';
const company = '33333333-3333-4333-8333-333333333333';
const password = 'Fixture-only-new-password';

function harness(options = {}) {
  const calls = { admin: 0, updates: [], audit: [], filters: [], limit: 0, mfa: 0, rpc: [] };
  const actor = { id: actorId, company_id: company, role: 'company_admin', status: 'active', ...options.actor };
  const target = options.missing ? null : { id: driverId, company_id: company, role: 'driver', status: 'active', ...options.target };
  let reads = 0;
  const deps = {
    createCaller: () => ({ auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: actorId } }, error: null }) },
      from: () => { const result = ++reads === 1 ? actor : target; const query = { select: () => query, eq: (key, value) => { calls.filters.push([key, value]); return query; }, single: async () => ({ data: result, error: null }), maybeSingle: async () => ({ data: result, error: null }) }; return query; } }),
    requireMfa: async () => { calls.mfa++; if (options.mfaFailure) throw Error('MFA_REQUIRED'); },
    createAdmin: () => { calls.admin++; return { rpc: async (name, args) => {
      calls.rpc.push([name, args]);
      if (name === 'read_driver_password_secret') return { data: { available: Boolean(options.stored), password, updatedAt: '2026-10-26T08:00:00Z' }, error: options.readFailure ? Error(password) : null };
      assert.equal(name, 'store_driver_password_secret');
      return { data: !options.storeFailure, error: options.storeFailure ? Error(password) : null };
    }, from: name => ({ insert: async record => { assert.equal(name, 'audit_events'); calls.audit.push(record); return { error: options.auditFailure ? Error('do not expose') : null }; } }),
      auth: { admin: { updateUserById: async (id, value) => { calls.updates.push([id, value]); return { data: { user: { id } }, error: options.providerFailure ? { code: 'weak_password', message: password } : null }; } } } }; },
    checkLimit: async () => { calls.limit++; return { allowed: !options.rateLimited, unavailable: options.limitUnavailable, retryAfterSeconds: 30 }; },
  };
  const request = (body = { driverId, password }, extra = {}) => new Request('https://example.invalid/functions/v1/update-driver-password', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-test-token', 'Content-Type': 'application/json', ...extra.headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { calls, deps, request, run: (body, extra) => handleDriverPassword(request(body, extra), deps) };
}

test('only an authenticated active company admin can set a driver password', async () => {
  for (const options of [{ signedOut: true }, { actor: { role: 'dispatcher' } }, { actor: { role: 'driver' } }, { actor: { role: 'super_admin' } }, { actor: { status: 'suspended' } }, { actor: { company_id: null } }, { mfaFailure: true }]) {
    const h = harness(options); const response = await h.run();
    assert.ok([401, 403].includes(response.status)); assert.equal(h.calls.admin, 0); assert.equal(h.calls.updates.length, 0);
  }
  const h = harness();
  const unauthorized = await handleDriverPassword(new Request('https://example.invalid', { method: 'POST' }), h.deps);
  assert.equal(unauthorized.status, 401); assert.equal(h.calls.mfa, 0);
});

test('another company, another role, deleted and missing targets never reach privileged auth', async () => {
  for (const options of [{ missing: true }, { target: { company_id: 'other-company' } }, { target: { role: 'company_admin' } }, { target: { status: 'deleted' } }]) {
    const h = harness(options); const response = await h.run();
    assert.equal(response.status, 404); assert.equal(h.calls.admin, 0);
  }
});

test('invalid IDs, malformed and oversized bodies and invalid passwords cannot change an account', async () => {
  for (const body of [{ driverId: actorId, password }, { driverId: 'invalid', password }, { driverId, password: 'short' }, { driverId, password: ' '.repeat(15) }, { driverId, password: 'x'.repeat(129) }, { driverId, password: {} }, '{invalid-json', 'x'.repeat(4100)]) {
    const h = harness(); const response = await h.run(body);
    assert.ok([400, 413].includes(response.status)); assert.equal(h.calls.admin, 0);
  }
});

test('driver password boundary accepts six characters and longer but rejects five', async () => {
  for (const length of [5, 6, 7, 12, 128, 129]) {
    const h = harness(); const value = 'a'.repeat(length);
    const response = await h.run({ driverId, password: value });
    assert.equal(response.status, length >= 6 && length <= 128 ? 200 : 400);
    assert.equal(h.calls.updates.length, length >= 6 && length <= 128 ? 1 : 0);
  }
});

test('rate limits and audit failures fail closed before changing the password', async () => {
  for (const options of [{ rateLimited: true }, { rateLimited: true, limitUnavailable: true }, { auditFailure: true }]) {
    const h = harness(options); const response = await h.run();
    assert.ok([429, 503].includes(response.status)); assert.equal(h.calls.updates.length, 0);
  }
});

test('authorized resets audit only intent, never return or persist the secret in profile/audit data', async () => {
  const h = harness({ target: { status: 'suspended' } }); const response = await h.run();
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, retained: true });
  assert.ok(response.headers.get('Cache-Control').includes('no-store'));
  assert.deepEqual(h.calls.updates, [[driverId, { password }]]);
  assert.ok(h.calls.filters.some(([key, value]) => key === 'company_id' && value === company));
  assert.equal(h.calls.audit[0].actor_id, actorId); assert.equal(h.calls.audit[0].entity_id, driverId);
  assert.equal(JSON.stringify(h.calls.audit).includes(password), false);
  assert.deepEqual(h.calls.rpc.at(-1), ['store_driver_password_secret', { p_actor: actorId, p_driver: driverId, p_password: password }]);
});

test('a storage readiness failure prevents reset; a later retention failure reports the successful reset separately', async () => {
  const unavailable = harness({ readFailure: true });
  assert.equal((await unavailable.run()).status, 503);
  assert.equal(unavailable.calls.updates.length, 0);
  const partial = harness({ storeFailure: true });
  const response = await partial.run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, retained: false });
  assert.equal(partial.calls.updates.length, 1);
});

test('reading secrets rejects unauthorized, non-admin, MFA and cross-company requests before privileged RPC', async () => {
  for (const options of [{ signedOut: true }, { actor: { role: 'dispatcher' } }, { actor: { status: 'suspended' } }, { mfaFailure: true }, { target: { company_id: 'another-company' } }, { target: { status: 'deleted' } }]) {
    const h = harness(options);
    const response = await handleReadDriverPassword(h.request({ driverId, action: 'reveal' }), h.deps);
    assert.ok([401,403,404].includes(response.status));
    assert.equal(h.calls.rpc.length, 0);
  }
});

test('status never returns plaintext and explicit reveal uses scoped RPC with no-store headers', async () => {
  for (const action of ['status', 'reveal']) {
    const h = harness({ stored: true });
    const response = await handleReadDriverPassword(h.request({ driverId, action }), h.deps);
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.available, true);
    assert.equal(data.password, action === 'reveal' ? password : undefined);
    assert.ok(response.headers.get('Cache-Control').includes('no-store'));
    assert.deepEqual(h.calls.rpc, [['read_driver_password_secret', { p_actor: actorId, p_driver: driverId, p_reveal: action === 'reveal' }]]);
  }
  const h = harness();
  const response = await handleReadDriverPassword(h.request({ driverId, action: 'reveal' }), h.deps);
  assert.deepEqual(await response.json(), { available: false });
});

test('secret read validates actions, rate limits, and hides credential-bearing database errors', async () => {
  for (const options of [{ rateLimited: true }, { rateLimited: true, limitUnavailable: true }, { readFailure: true }]) {
    const h = harness(options);
    const response = await handleReadDriverPassword(h.request({ driverId, action: 'reveal' }), h.deps);
    assert.ok([429,503].includes(response.status));
    assert.equal((await response.text()).includes(password), false);
  }
  const h = harness();
  assert.equal((await handleReadDriverPassword(h.request({ driverId, action: 'export-all' }), h.deps)).status, 400);
  assert.equal(h.calls.rpc.length, 0);
});

test('provider rejections return fixed codes, never provider messages containing credentials', async () => {
  const h = harness({ providerFailure: true }); const response = await h.run();
  assert.equal(response.status, 422); const text = await response.text();
  assert.equal(text.includes(password), false); assert.equal(JSON.parse(text).error, 'PASSWORD_REJECTED');
});
