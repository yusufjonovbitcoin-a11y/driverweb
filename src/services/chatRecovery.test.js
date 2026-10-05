import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRecovery } from './chatRecovery.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

test('initial open failure retries automatically and reaches history without page reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0; const states = []; const history = [];
  const loader = createChatRecovery({ load: async () => { if (++attempts === 1) throw new Error('network'); history.push('message'); }, onState: (state) => states.push(state) });
  await loader.run();
  assert.equal(attempts, 1); assert.equal(states.at(-1).error.message, 'network');
  t.mock.timers.tick(1000); await settle();
  assert.equal(attempts, 2); assert.deepEqual(history, ['message']);
  assert.deepEqual(states.at(-1), { loading: false, error: null });
  loader.dispose();
});

test('reopening the page, focus and realtime share a single pending request', async () => {
  const response = deferred(); let attempts = 0;
  const loader = createChatRecovery({ load: () => { attempts++; return response.promise; }, onState: () => {} });
  const first = loader.run();
  assert.equal(loader.run(), first); assert.equal(loader.run(), first);
  await settle(); assert.equal(attempts, 1);
  response.resolve(); await first;
  await loader.run(); assert.equal(attempts, 2);
  loader.dispose();
});

test('automatic failures are bounded, and manual retry starts a fresh recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const loader = createChatRecovery({ load: async () => { attempts++; throw new Error('offline'); }, onState: () => {} });
  await loader.run();
  t.mock.timers.tick(1000); await settle();
  t.mock.timers.tick(3000); await settle();
  t.mock.timers.tick(60000); await settle();
  assert.equal(attempts, 3);
  await loader.run(); assert.equal(attempts, 4);
  loader.dispose();
});

test('hung requests time out; their late results cannot overwrite recovered history', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = deferred(); const applied = []; const states = []; let attempts = 0;
  const loader = createChatRecovery({ timeoutMs: 20, load: async (current) => {
    const value = ++attempts === 1 ? await old.promise : 'new';
    if (current()) applied.push(value);
  }, onState: (state) => states.push(state) });
  const first = loader.run(); await settle();
  t.mock.timers.tick(20); await first;
  assert.equal(states.at(-1).error.message, 'CHAT_REQUEST_TIMEOUT');
  await loader.run();
  old.resolve('old'); await settle();
  assert.deepEqual(applied, ['new']);
  loader.dispose();
});

test('switching drivers cancels pending state updates and scheduled retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = deferred(); const states = []; const applied = [];
  const loader = createChatRecovery({ load: async (current) => { await response.promise; if (current()) applied.push('wrong driver'); }, onState: (state) => states.push(state) });
  const pending = loader.run(); await settle(); loader.dispose(); await pending;
  response.resolve(); await settle(); t.mock.timers.tick(60000); await settle();
  assert.equal(states.length, 1); assert.deepEqual(applied, []);
  await loader.run(); assert.equal(states.length, 1);
});

test('manual retry replaces a scheduled retry instead of causing duplicate requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const loader = createChatRecovery({ load: async () => { if (++attempts === 1) throw new Error('once'); }, onState: () => {} });
  await loader.run(); await loader.run();
  t.mock.timers.tick(60000); await settle();
  assert.equal(attempts, 2);
  loader.dispose();
});
