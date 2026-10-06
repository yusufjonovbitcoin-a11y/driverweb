import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPushController } from './webPushController.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(overrides = {}) {
  const events = [];
  const deps = {
    permission: () => 'granted', requestPermission: async () => 'granted',
    setWorkerEnabled: async (value) => events.push(['worker', value]),
    getToken: async () => 'token', deleteToken: async () => events.push(['delete']),
    sessionUserId: async () => 'a', register: async (token) => events.push(['register', token]),
    unregister: async (token) => events.push(['unregister', token]),
    saveToken: (token) => events.push(['token', token]), readToken: () => 'token',
    saveEnabled: (id, enabled) => events.push(['preference', id, enabled]), ...overrides,
  };
  const controller = createWebPushController(deps); controller.setAccount('a');
  return { controller, events };
}
test('enable registers web endpoint before allowing the worker to display pushes', async () => {
  const { controller, events } = setup();
  assert.equal(await controller.enable(), true);
  assert.deepEqual(events, [['worker', false], ['register', 'token'], ['token', 'token'], ['preference', 'a', true], ['worker', true]]);
});
test('does not request permission automatically', async () => {
  let requested = 0;
  const { controller } = setup({ requestPermission: async () => { requested++; return 'granted'; } });
  await controller.enable(); assert.equal(requested, 0);
  await controller.enable({ requestPermission: true }); assert.equal(requested, 1);
});
test('denied permission never registers an endpoint', async () => {
  const { controller, events } = setup({ requestPermission: async () => 'denied' });
  await assert.rejects(controller.enable({ requestPermission: true }), /denied/);
  assert.deepEqual(events, []);
});
test('logout while permission prompt is open prevents registration', async () => {
  const permission = deferred();
  const { controller, events } = setup({ requestPermission: () => permission.promise });
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
  assert.equal(events.some(([name, value]) => name === 'worker' && value), false);
});
test('registration error never enables worker and revokes subscription', async () => {
  const { controller, events } = setup({ register: async () => { throw new Error('offline'); } });
  await assert.rejects(controller.enable(), /offline/);
  assert.ok(events.some(([name]) => name === 'delete'));
  assert.equal(events.some(([name, value]) => name === 'worker' && value), false);
});
test('failed server unregister still revokes physical browser endpoint', async () => {
  const { controller, events } = setup({ unregister: async () => { throw new Error('offline'); } });
  assert.deepEqual(await controller.disable(), { databaseRevoked: false });
  assert.ok(events.some(([name]) => name === 'delete'));
  assert.deepEqual(events.at(-1), ['token', null]);
});
test('worker timeout must not stop browser endpoint revocation', async () => {
  const { controller, events } = setup({ setWorkerEnabled: async () => { throw new Error('timeout'); } });
  await controller.disable();
  assert.ok(events.some(([name]) => name === 'delete'));
});
