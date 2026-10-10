import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8');
const origin = 'https://managefleets.com';
const now = Date.parse('2026-10-08T12:00:00Z');
const prefs = (extra = {}) => ({ type: 'TFLEEST_PUSH_PREFERENCES', enabled: true, userId: 'user-a', calls: true, messages: true, locale: 'en', ...extra });
const call = (extra = {}) => ({ event: 'incoming_call', recipient_id: 'user-a', call_id: 'call-1', caller_name: 'Alex', expires_at: new Date(now + 60_000).toISOString(), ...extra });
const message = (extra = {}) => ({ type: 'chat_message', recipient_id: 'user-a', notificationId: 'note-1', chatMessageId: 'msg-1', sender_name: 'Sam', body: 'PRIVATE CHAT TEXT', created_at: new Date(now).toISOString(), ...extra });
function harness({ shared = new Map(), windows, showFails = false } = {}) {
  let time = now;
  const handlers = new Map(), notifications = [], opened = [], navigated = [], focused = [], timers = new Map();
  let nextTimer = 0;
  const windowClient = { id: 'window-1', type: 'window', url: `${origin}/#chat`, visibilityState: 'visible',
    async navigate(url) { navigated.push(url); this.url = url; return this; },
    async focus() { focused.push(this.id); return this; },
  };
  const clients = windows ?? [windowClient];
  const caches = { async open(name) { if (!shared.has(name)) shared.set(name, new Map()); const cache = shared.get(name); return {
    async match(key) { return cache.get(key)?.clone(); }, async put(key, response) { cache.set(key, response.clone()); },
  }; }, async delete(name) { return shared.delete(name); } };
  const context = { URL, Response, Map, Date: class extends Date { static now() { return time; } },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, due: time + delay }); return id; }, clearTimeout(id) { timers.delete(id); }, caches,
    self: { location: { origin }, addEventListener(name, handler) { handlers.set(name, handler); }, async skipWaiting() {},
      clients: { async get(id) { return clients.find((client) => client.id === id); }, async matchAll() { return clients; }, async openWindow(url) { opened.push(url); } },
      registration: { async getNotifications() { return notifications.filter((notification) => !notification.closed); }, async showNotification(title, options) {
        if (showFails) throw new Error('browser permission denied');
        notifications.push({ title, ...structuredClone(options), closed: false, close() { this.closed = true; } });
      } },
    },
  };
  vm.runInNewContext(source, context);
  async function dispatch(type, fields = {}) {
    const work = []; handlers.get(type)({ waitUntil(promise) { work.push(promise); }, ...fields }); await Promise.all(work);
  }
  return { shared, notifications, opened, navigated, focused, clients, timers,
    async send(data, extra = {}) { let ack; await dispatch('message', { data, origin, source: windowClient, ports: [{ postMessage(value) { ack = structuredClone(value); } }], ...extra }); return ack; },
    async push(data, extra = {}) { await dispatch('push', { data: { json: () => ({ from: '931497947609', data, ...extra }) } }); },
    async click(notification) { await dispatch('notificationclick', { notification }); },
    async activate() { await dispatch('activate'); },
    async advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); timer.fn(); } await dispatch('push', { data: { json: () => ({ from: 'invalid' }) } }); },
  };
}

test('branded call/message notifications display even with visible chat without leaking text', async () => {
  const h = harness(); assert.equal((await h.send(prefs())).protocolVersion, 2); await h.push(call()); await h.push(message());
  assert.equal(h.notifications.length, 2);
  assert.equal(h.notifications[0].title, 'T Fleets — Incoming Call'); assert.equal(h.notifications[0].body, 'Alex is calling');
  assert.equal(h.notifications[1].title, 'T Fleets — New Message'); assert.equal(h.notifications[1].body, 'New message from Sam. Open T Fleets to view it.');
  assert.ok(h.notifications.every((item) => !JSON.stringify(item).includes('PRIVATE CHAT TEXT')));
  assert.equal(h.notifications[0].actions, undefined, 'no autoaccept or unverified role');
});
test('category switches independently block their category and close only its existing banners', async () => {
  const h = harness(); await h.send(prefs()); await h.push(call()); await h.push(message());
  await h.send(prefs({ calls: false })); assert.equal(h.notifications[0].closed, true); assert.equal(h.notifications[1].closed, false);
  await h.push(call({ call_id: 'call-2' })); await h.push(message({ notificationId: 'note-2', chatMessageId: 'msg-2' })); assert.equal(h.notifications.length, 3);
  await h.send(prefs({ messages: false })); await h.push(call({ call_id: 'call-3' })); await h.push(message({ notificationId: 'note-3', chatMessageId: 'msg-3' }));
  assert.equal(h.notifications.length, 4); assert.equal(h.notifications[2].closed, true);
});
test('recipient/account, missing binding, wrong sender and untrusted source fail closed', async () => {
  const h = harness(); await h.send(prefs());
  await h.push(message({ recipient_id: 'user-b' })); await h.push(message({ recipient_id: undefined })); await h.push(message(), { from: 'evil' });
  assert.deepEqual(await h.send({ type: 'TFLEETS_NOTIFY', payload: call() }, { origin: 'https://evil.example' }), { ok: false, error: 'untrusted_source' });
  assert.deepEqual(await h.send(prefs({ userId: 'user-b' }), { source: { id: 'unknown', type: 'window' } }), { ok: false, error: 'untrusted_source' });
  assert.equal(h.notifications.length, 0);
  await h.send({ type: 'TFLEEST_PUSH_PREFERENCES', enabled: true, locale: 'en' }); await h.push(call()); assert.equal(h.notifications.length, 0);
});
test('legacy enabled-only persisted state cannot authorize the upgraded worker', async () => {
  const shared = new Map([['tfleest-push-preferences-v1', new Map([[`${origin}/__tfleest_push_preferences`, Response.json({ enabled: true, locale: 'ru' })]])]]);
  const h = harness({ shared }); await h.activate(); await h.push(call()); assert.equal(h.notifications.length, 0); assert.equal(shared.has('tfleest-push-preferences-v1'), false);
  await h.send(prefs()); await h.push(call()); assert.equal(h.notifications.length, 1);
});
test('realtime/push share IDs; persistent bounded dedupe survives restart and stores no private payload', async () => {
  const h = harness(); await h.send(prefs());
  assert.equal((await h.send({ type: 'TFLEETS_NOTIFY', payload: { data: message() } })).shown, true);
  await Promise.all([h.push(message()), h.push(message({ notificationId: 'different-note' }))]);
  await h.send({ type: 'TFLEETS_NOTIFY', payload: call() }); await h.push(call()); assert.equal(h.notifications.length, 2);
  const restarted = harness({ shared: h.shared }); await restarted.push(message()); await restarted.push(call()); assert.equal(restarted.notifications.length, 0);
  for (let i = 0; i < 170; i++) await h.push(message({ notificationId: `n-${i}`, chatMessageId: `m-${i}` }));
  const state = await [...h.shared.get('tfleets-push-preferences-v2').values()][0].clone().json();
  assert.ok(state.seen.length <= 160); assert.doesNotMatch(JSON.stringify(state), /PRIVATE CHAT TEXT|Alex|Sam|expires_at/);
});
test('expired/missing/unbounded call deadlines and ended-before-incoming do not ring', async () => {
  const h = harness(); await h.send(prefs());
  for (const expires_at of [undefined, 'bad', new Date(now - 1).toISOString(), new Date(now + 1_000).toISOString(), new Date(now + 121_000).toISOString()]) await h.push(call({ expires_at }));
  await h.push(call({ event: 'call_ended', expires_at: undefined })); await h.push(call()); assert.equal(h.notifications.length, 0);
  await h.push(call({ call_id: 'live-call' })); assert.equal(h.notifications.length, 1);
  await h.advance(60_000); assert.equal(h.notifications[0].closed, true); await h.click(h.notifications[0]); assert.equal(h.focused.length, 0);
});
test('call end closes only matching account/call; foreground close cannot target another account', async () => {
  const h = harness(); await h.send(prefs()); await h.push(call()); await h.push(call({ call_id: 'call-2' }));
  await h.send({ type: 'TFLEETS_CLOSE_CALL', userId: 'user-b', callId: 'call-1' }); assert.equal(h.notifications[0].closed, false);
  await h.push(call({ event: 'call_ended' })); assert.equal(h.notifications[0].closed, true); assert.equal(h.notifications[1].closed, false);
  await h.send({ type: 'TFLEETS_CLOSE_CALL', userId: 'user-a', callId: 'call-2' }); assert.equal(h.notifications[1].closed, true);
});
test('ended calls are remembered while disabled and cannot ring after re-enabling', async () => {
  const h = harness(); await h.send(prefs({ enabled: false }));
  await h.push(call({ event: 'call_ended' })); await h.send(prefs()); await h.push(call());
  assert.equal(h.notifications.length, 0);
});
test('a duplicate push teaches the notification alias and safely ignores later ID-only delivery', async () => {
  const h = harness(); await h.send(prefs());
  await h.send({ type: 'TFLEETS_NOTIFY', payload: message({ notificationId: undefined }) });
  await h.push(message()); await h.push(message({ chatMessageId: undefined }));
  assert.equal(h.notifications.length, 1);
});
test('logout/account switch closes banners, cancels timers and refuses old-account clicks', async () => {
  const h = harness(); await h.send(prefs()); await h.push(call()); await h.push(message());
  await h.send(prefs({ enabled: false, userId: null })); assert.ok(h.notifications.every((item) => item.closed)); assert.equal(h.timers.size, 0);
  await h.click(h.notifications[1]); assert.equal(h.focused.length, 0);
  await h.send(prefs({ userId: 'user-b' })); await h.push(call()); assert.equal(h.notifications.length, 2);
  await h.push(message({ recipient_id: 'user-b' })); assert.equal(h.notifications.length, 3);
});
test('click focuses/navigates same-origin chat; payload URLs/tokens never enter click data', async () => {
  const h = harness(); await h.send(prefs()); await h.push(call({ url: 'https://evil.example', link: 'javascript:alert(1)', capability: 'SECRET' }));
  await h.click(h.notifications[0]); assert.equal(h.focused.length, 1); assert.equal(h.navigated.length, 0);
  assert.doesNotMatch(JSON.stringify(h.notifications[0].data), /evil|SECRET|javascript/);
  h.clients[0].url = `${origin}/#drivers`; await h.click(h.notifications[0]); assert.deepEqual(h.navigated, [`${origin}/#chat`]);
  h.clients.length = 0; await h.click(h.notifications[0]); assert.deepEqual(h.opened, [`${origin}/#chat`]);
});
test('test banners are foreground-only and missing caller never invents a dispatcher role', async () => {
  const h = harness(); await h.send(prefs()); await h.push(call({ test: true })); assert.equal(h.notifications.length, 0);
  assert.equal((await h.send({ type: 'TFLEETS_NOTIFY', payload: call({ test: true, caller_name: '' }) })).shown, true);
  assert.equal(h.notifications[0].title, 'T Fleets — Call notification test'); assert.equal(h.notifications[0].body, 'This is a test notification from T Fleets.');
  await h.push(call({ call_id: 'anonymous', caller_name: '', caller_role: 'Dispatch' })); assert.equal(h.notifications[1].body, 'Someone is calling');
  await h.send(prefs({ locale: 'uz' })); await h.push(message()); assert.equal(h.notifications[2].title, 'T Fleets — Yangi xabar');
});
test('OS failures are handled and do not mark unseen notifications delivered', async () => {
  const h = harness({ showFails: true }); await h.send(prefs());
  assert.deepEqual(await h.send({ type: 'TFLEETS_NOTIFY', payload: call() }), { ok: false, error: 'notification_unavailable' }); await h.push(message());
  const state = await [...h.shared.get('tfleets-push-preferences-v2').values()][0].clone().json(); assert.equal(state.seen.length, 0);
});
test('remote chat rejects old/missing/invalid/far-future creation times before display', async () => {
  for (const created_at of [undefined, '', 'not-a-date', 123, '2026-10-08', '2026-10-08T12:00:00',
    new Date(now - 3_600_001).toISOString(), new Date(now + 60_001).toISOString()]) {
    const h = harness(); await h.send(prefs()); await h.push(message({ created_at }));
    await h.push(message({ type: undefined, entityType: 'chat_conversation', created_at }));
    assert.equal(h.notifications.length, 0, String(created_at));
  }
});
test('remote chat accepts one-hour boundary, camel timestamp, and bounded clock skew', async () => {
  for (const timestamp of [now - 3_600_000, now, now + 60_000]) {
    const h = harness(); await h.send(prefs());
    await h.push(message({ created_at: undefined, createdAt: new Date(timestamp).toISOString() }));
    assert.equal(h.notifications.length, 1, String(timestamp));
  }
});
test('trusted foreground tests bypass timestamp while remote test payloads remain refused', async () => {
  const h = harness(); await h.send(prefs());
  await h.push(message({ test: true, created_at: undefined })); assert.equal(h.notifications.length, 0);
  const result = await h.send({ type: 'TFLEETS_NOTIFY', payload: message({ test: true, created_at: undefined }) });
  assert.equal(result.shown, true); assert.equal(h.notifications[0].title, 'T Fleets — Message notification test');
});
