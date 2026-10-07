import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeAuthenticatedFunction } from './authenticatedFunction.js';

const session = (id, ttl = 3600) => ({ user: { id }, access_token: `${id}-token`, expires_at: Date.now() / 1000 + ttl });
function fixture(initial = session('A')) {
  const state = { session: initial, calls: [], refreshes: 0, signouts: 0 };
  state.client = {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      refreshSession: async () => { state.refreshes++; return state.refresh ? state.refresh() : { data: { session: state.session } }; },
      signOut: async () => { state.signouts++; },
    },
    functions: { invoke: async (name, options) => { state.calls.push({ name, ...options }); return state.invoke ? state.invoke() : { data: 'ok' }; } },
  };
  return state;
}
test('retryable refresh failure keeps a valid login and sends its valid token', async () => {
  const state = fixture(session('A', 240));
  state.refresh = () => ({ error: Object.assign(new Error('503'), { name: 'AuthRetryableFetchError' }) });
  assert.equal((await invokeAuthenticatedFunction(state.client, 'gmail-integration', { action: 'disconnect' })).data, 'ok');
  assert.equal(state.signouts, 0); assert.equal(state.calls[0].headers.Authorization, 'Bearer A-token');
});
test('expired/rejected refresh never sends a mutation or signs out another session', async () => {
  for (const ttl of [-1, 240]) {
    const state = fixture(session('A', ttl));
    state.refresh = () => ({ error: new Error('refresh rejected') });
    await assert.rejects(invokeAuthenticatedFunction(state.client, 'gmail-integration', {}), /refresh rejected/);
    assert.equal(state.calls.length, 0); assert.equal(state.signouts, 0);
  }
});
test('401 cannot replay account A disconnect after another tab signs in as B', async () => {
  const state = fixture();
  state.invoke = () => { state.session = session('B'); return { error: { context: { status: 401 } } }; };
  await assert.rejects(invokeAuthenticatedFunction(state.client, 'gmail-integration', { action: 'disconnect' }), /Hisob o‘zgardi/);
  assert.equal(state.calls.length, 1); assert.equal(state.refreshes, 0); assert.equal(state.signouts, 0);
});
test('account switch while refresh is in flight cannot change mutation identity', async () => {
  const state = fixture(session('A', 240));
  state.refresh = () => ({ data: { session: session('B') } });
  await assert.rejects(invokeAuthenticatedFunction(state.client, 'gmail-integration', {}), /Hisob o‘zgardi/);
  assert.equal(state.calls.length, 0);
});
test('same-account 401 refresh retries once and cannot override the bound Authorization', async () => {
  const state = fixture();
  state.invoke = () => state.calls.length === 1 ? { error: { context: { status: 401 } } } : { data: 'retried' };
  state.refresh = () => ({ data: { session: { ...state.session, access_token: 'fresh-A' } } });
  const result = await invokeAuthenticatedFunction(state.client, 'gmail-integration', { action: 'disconnect' }, { headers: { Authorization: 'Bearer B', custom: 'kept' } });
  assert.equal(result.data, 'retried'); assert.equal(state.refreshes, 1);
  assert.equal(state.calls[1].headers.Authorization, 'Bearer fresh-A');
  assert.equal(state.calls[1].headers.custom, 'kept');
});
