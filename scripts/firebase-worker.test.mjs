import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8');
function worker({ enabled = true, windows = [], locale = 'en' } = {}) {
  const handlers = {};
  const shown = []; const opened = [];
  let preferences = { enabled, locale };
  const self = {
    location: { origin: 'https://example.com' },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (...args) => shown.push(args), getNotifications: async () => [] },
    clients: { matchAll: async () => windows, openWindow: async (url) => opened.push(url) },
  };
  vm.runInNewContext(code, { self, URL, Response, caches: { open: async () => ({
    match: async () => new Response(JSON.stringify(preferences)),
    put: async (_key, value) => { preferences = await value.json(); },
  }) } });
  const dispatch = (name, event) => { let work; handlers[name]({ ...event, waitUntil: (promise) => { work = promise; } }); return work; };
  return { shown, opened, dispatch };
}
const push = { from: '931497947609', notification: { title: 'Private driver name', body: 'Private message' },
  data: { entityType: 'chat_conversation', notificationId: '123', url: 'https://evil.test' } };
test('background push shows one generic notification without private content', async () => {
  const w = worker(); await w.dispatch('push', { data: { json: () => push } });
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0][1].data.route, 'chat');
  assert.equal(JSON.stringify(w.shown).includes('Private'), false);
});
test('visible chat suppresses duplicate notifications', async () => {
  const w = worker({ windows: [{ visibilityState: 'visible', url: 'https://example.com/#chat' }] });
  await w.dispatch('push', { data: { json: () => push } });
  assert.equal(w.shown.length, 0);
});
test('disabled worker or another Firebase sender cannot display notifications', async () => {
  for (const options of [{ enabled: false }, {}]) {
    const w = worker(options);
    await w.dispatch('push', { data: { json: () => options.enabled === false ? push : { ...push, from: 'other' } } });
    assert.equal(w.shown.length, 0);
  }
});
test('malformed payload is harmless', async () => {
  const w = worker(); await w.dispatch('push', { data: { json: () => { throw new Error(); } } });
  assert.equal(w.shown.length, 0);
});
test('click opens same-origin route, ignores remote payload URL', async () => {
  const w = worker(); await w.dispatch('notificationclick', {
    notification: { close() {}, data: { route: 'https://evil.test', url: 'https://evil.test' } },
  });
  assert.deepEqual(w.opened, ['https://example.com/#inbox']);
});
test('click reuses an existing window', async () => {
  const calls = [];
  const w = worker({ windows: [{ url: 'https://example.com/#map',
    navigate: async (url) => calls.push(url), focus: async () => calls.push('focus') }] });
  await w.dispatch('notificationclick', { notification: { close() {}, data: { route: 'chat' } } });
  assert.deepEqual(calls, ['https://example.com/#chat', 'focus']);
  assert.equal(w.opened.length, 0);
});
test('worker disabled preference persists and acknowledges only after saving', async () => {
  const w = worker(); let ack = false;
  await w.dispatch('message', { data: { type: 'TFLEEST_PUSH_PREFERENCES', enabled: false, locale: 'uz' }, ports: [{ postMessage: () => { ack = true; } }] });
  assert.equal(ack, true);
  await w.dispatch('push', { data: { json: () => push } }); assert.equal(w.shown.length, 0);
});
