import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPushController } from './webPushController.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(overrides = {}) {
  const events = [];
  const deps = {
    permission: () => 'granted', requestPermission: async () => 'granted',
    setWorkerPreferences: async (value) => events.push(['worker', value]),
    getToken: async () => 'token', deleteToken: async () => events.push(['delete']),
    sessionUserId: async () => 'a', register: async (token) => events.push(['register', token]),
    unregister: async (token) => events.push(['unregister', token]),
    saveToken: (token) => events.push(['token', token]), readToken: () => 'token',
    savePreferences: (id, value) => events.push(['preference', id, value]), ...overrides,
  };
  const controller = createWebPushController(deps); controller.setAccount('a');
  return { controller, events };
}
test('enable registers web endpoint before allowing the worker to display pushes', async () => {
  const { controller, events } = setup();
  assert.equal(await controller.enable(), true);
  assert.ok(events.findIndex(([name]) => name === 'register') < events.findIndex(([name, value]) => name === 'worker' && value.enabled));
  assert.deepEqual(events.at(-1), ['preference', 'a', { calls: true, messages: true }]);
});
test('does not request permission automatically', async () => {
  let requested = 0;
  const { controller } = setup({ permission: () => 'default', requestPermission: async () => { requested++; return 'granted'; } });
  await assert.rejects(controller.enable(), /off/); assert.equal(requested, 0);
  await controller.enable({ requestPermission: true }); assert.equal(requested, 1);
});
test('denied permission never registers an endpoint', async () => {
  const { controller, events } = setup({ permission: () => 'default', requestPermission: async () => 'denied' });
  await assert.rejects(controller.enable({ requestPermission: true }), /denied/);
  assert.equal(events.some(([name]) => name === 'register' || name === 'preference'), false);
});
test('logout while permission prompt is open prevents registration', async () => {
  const permission = deferred();
  const { controller, events } = setup({ permission: () => 'default', requestPermission: () => permission.promise });
  const enabling = controller.enable({ requestPermission: true });
  await controller.disable(); controller.setAccount(null); permission.resolve('granted');
  assert.equal(await enabling, false);
  assert.equal(events.some(([name]) => name === 'register'), false);
});
test('switching account during token fetch revokes the new endpoint', async () => {
  const token = deferred(); const started = deferred();
  const { controller, events } = setup({ getToken: () => { started.resolve(); return token.promise; } });
  const pending = controller.enable(); await started.promise;
  controller.setAccount('b'); token.resolve('new-token');
  assert.equal(await pending, false);
  assert.ok(events.some(([name]) => name === 'delete'));
  assert.equal(events.some(([name]) => name === 'register'), false);
});
test('auth session mismatch fails closed before RPC', async () => {
  const { controller, events } = setup({ sessionUserId: async () => 'b' });
  await assert.rejects(controller.enable(), /signedOut/);
  assert.equal(events.some(([name]) => name === 'register'), false);
  assert.equal(events.some(([name, value]) => name === 'worker' && value.enabled), false);
});
test('registration error never enables worker and revokes subscription', async () => {
  const { controller, events } = setup({ register: async () => { throw new Error('offline'); } });
  await assert.rejects(controller.enable(), /offline/);
  assert.ok(events.some(([name]) => name === 'delete'));
  assert.equal(events.some(([name, value]) => name === 'worker' && value.enabled), false);
});
test('failed server unregister still revokes physical browser endpoint', async () => {
  const { controller, events } = setup({ unregister: async () => { throw new Error('offline'); } });
  assert.deepEqual(await controller.disable(), { databaseRevoked: false });
  assert.ok(events.some(([name]) => name === 'delete'));
  assert.deepEqual(events.at(-1), ['token', null]);
});
test('worker timeout must not stop browser endpoint revocation', async () => {
  const { controller, events } = setup({ setWorkerPreferences: async () => { throw new Error('timeout'); } });
  await controller.disable();
  assert.ok(events.some(([name]) => name === 'delete'));
});

test('turning off one category preserves the other and does not revoke its endpoint', async () => {
  const { controller, events } = setup();
  await controller.updatePreferences({ calls: true, messages: false });
  assert.deepEqual(events.at(-1), ['preference', 'a', { calls: true, messages: false }]);
  assert.equal(events.some(([name]) => name === 'delete'), false);
  await controller.updatePreferences({ calls: false, messages: true });
  assert.deepEqual(events.at(-1), ['preference', 'a', { calls: false, messages: true }]);
});
test('both categories off revokes the endpoint and saves a scoped off preference', async () => {
  const { controller, events } = setup();
  assert.equal(await controller.updatePreferences({ calls: false, messages: false }), true);
  assert.ok(events.some(([name]) => name === 'delete'));
  assert.ok(events.some(([name, id, value]) => name === 'preference' && id === 'a' && !value.calls && !value.messages));
});
test('clear-all works even when shared browser permission is denied or unavailable', async () => {
  for (const permission of ['denied', 'unsupported']) {
    const { controller, events } = setup({ permission: () => permission, requestPermission: () => { throw new Error('Must not prompt'); } });
    await controller.disable();
    assert.ok(events.some(([name, owner, value]) => name === 'preference' && owner === 'a' && !value.calls && !value.messages));
    assert.ok(events.some(([name]) => name === 'delete'));
  }
});
test('worker ACK failure never persists enabled preferences', async () => {
  const { controller, events } = setup({ setWorkerPreferences: async (value) => { if (value.enabled) throw new Error('old-worker'); } });
  await assert.rejects(controller.enable(), /old-worker/);
  assert.equal(events.some(([name]) => name === 'preference'), false);
  assert.ok(events.some(([name]) => name === 'delete'));
});
test('account switch during worker ACK never persists the previous user choice', async () => {
  const ack = deferred(); const started = deferred();
  const { controller, events } = setup({ setWorkerPreferences: async (value) => { if (value.enabled) { started.resolve(); await ack.promise; } } });
  const pending = controller.enable(); await started.promise;
  controller.setAccount('b'); ack.resolve();
  assert.equal(await pending, false);
  assert.equal(events.some(([name]) => name === 'preference'), false);
});
test('already granted shared permission does not prompt again when enabling another category', async () => {
  let prompts = 0;
  const { controller } = setup({ requestPermission: async () => { prompts++; return 'granted'; } });
  await controller.updatePreferences({ calls: true, messages: false }, { requestPermission: true });
  await controller.updatePreferences({ calls: true, messages: true }, { requestPermission: true });
  assert.equal(prompts, 0);
});

test('same-account initial sync, category changes, off and re-register retain worker dedupe ownership', async () => {
  const { controller, events } = setup();
  await controller.updatePreferences({ calls: true, messages: false });
  await controller.updatePreferences({ calls: true, messages: true });
  await controller.updatePreferences({ calls: false, messages: false });
  await controller.updatePreferences({ calls: true, messages: false });
  const configurations = events.filter(([name]) => name === 'worker').map(([, value]) => value);
  assert.ok(configurations.length >= 5);
  assert.ok(configurations.every(value => value.userId === 'a'));
  assert.equal(configurations[0].enabled, false);
});

test('real account transition clears worker ownership, while first mount binds its account', async () => {
  const { controller, events } = setup();
  await controller.enable();
  controller.setAccount('b');
  await controller.disable();
  const configurations = events.filter(([name]) => name === 'worker').map(([, value]) => value);
  assert.equal(configurations[0].userId, 'a');
  assert.ok(configurations.some(value => value.userId === null && !value.enabled));
  assert.equal(configurations.at(-1).userId, 'b');
  controller.setAccount(null);
  await controller.disable();
  assert.equal(events.filter(([name]) => name === 'worker').at(-1)[1].userId, null);
});

test('background refresh reads preferences after acquiring another tab lock and never writes a stale snapshot', async () => {
  const gate = deferred();
  let saved = { calls: true, messages: true };
  const registered = [];
  const { controller, events } = setup({ lock: async fn => { await gate.promise; return fn(); }, readPreferences: () => saved,
    register: async (_, preferences) => { registered.push(preferences); } });
  const pending = controller.refresh();
  saved = { calls: true, messages: false };
  gate.resolve(); await pending;
  assert.equal(events.some(([name]) => name === 'preference'), false);
  const config = events.filter(([name]) => name === 'worker').at(-1)[1];
  assert.equal(config.calls, true); assert.equal(config.messages, false);
  assert.deepEqual(registered, [{ calls: true, messages: false }]);
});

test('background token refresh cannot restore settings switched off while the token request was pending', async () => {
  const started = deferred(); const token = deferred();
  let saved = { calls: true, messages: true };
  const { controller, events } = setup({ readPreferences: () => saved, getToken: () => { started.resolve(); return token.promise; } });
  const pending = controller.refresh(); await started.promise;
  saved = { calls: false, messages: false }; token.resolve('token'); await pending;
  assert.equal(events.some(([name]) => name === 'preference'), false);
  assert.equal(events.some(([name, value]) => name === 'worker' && value.enabled), false);
  assert.ok(events.some(([name]) => name === 'delete'));
});

test('simultaneous different-category clicks merge under the shared cross-tab lock', async () => {
  let saved = { calls: false, messages: false };
  let queue = Promise.resolve();
  const lock = fn => { const pending = queue.then(fn); queue = pending.catch(() => {}); return pending; };
  const dependencies = { lock, readPreferences: () => saved, savePreferences: (_, value) => { saved = value; } };
  const a = setup(dependencies).controller; const b = setup(dependencies).controller;
  await Promise.all([
    a.updatePreferences({ calls: true, messages: false }, { category: 'calls' }),
    b.updatePreferences({ calls: false, messages: true }, { category: 'messages' }),
  ]);
  assert.deepEqual(saved, { calls: true, messages: true });
});

test('a hung provider request times out and does not permanently block following operations', async () => {
  let attempts = 0;
  const { controller } = setup({ timeoutMs: 5, getToken: () => ++attempts === 1 ? new Promise(() => {}) : Promise.resolve('token') });
  await assert.rejects(controller.enable(), /workerTimeout/);
  assert.equal(await controller.enable(), true);
});

test('partial registration failure revokes the new token even before local token persistence', async () => {
  const { controller, events } = setup({ readToken: () => 'old-token', getToken: async () => 'new-token',
    register: async () => { throw new Error('category RPC failed after device registration'); } });
  await assert.rejects(controller.enable(), /category RPC failed/);
  assert.ok(events.some(([name, token]) => name === 'unregister' && token === 'new-token'));
  assert.ok(events.some(([name, token]) => name === 'unregister' && token === 'old-token'));
  assert.equal(events.some(([name]) => name === 'preference'), false);
});
test('token rotation unregisters only this browser previous token before registering replacement', async () => {
  const { controller, events } = setup({ readToken: () => 'old-token', getToken: async () => 'new-token' });
  await controller.enable();
  assert.deepEqual(events.filter(([name]) => name === 'unregister'), [['unregister', 'old-token']]);
  assert.ok(events.findIndex(([name]) => name === 'unregister') < events.findIndex(([name]) => name === 'register'));
  assert.ok(events.some(([name, token]) => name === 'token' && token === 'new-token'));
});
