import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

const bundle = await rolldown({ input: new URL('./webPush.js', import.meta.url).pathname,
  plugins: [{ name: 'isolated-push-dependencies', resolveId(id) {
    if (id.endsWith('/lib/supabase.js')) return '\0supabase';
    if (id.endsWith('/firebaseConfig.js')) return '\0firebase';
    if (id === 'firebase/messaging') return '\0messaging';
  }, load(id) {
    if (id === '\0supabase') return 'export const supabase = globalThis.testClient;';
    if (id === '\0firebase') return 'export const firebaseVapidKey="test-public-key"; export const getFirebaseApp=async()=>({});';
    if (id === '\0messaging') return 'export const isSupported=async()=>true; export const getMessaging=()=>({}); export const getToken=async()=>"test-token";';
  } }],
});
const { output } = await bundle.generate({ format: 'iife', name: 'PushModule', codeSplitting: false });
await bundle.close();

function harness({ protocolVersion = 2, updateProtocol = false } = {}) {
  const messages = []; const events = []; const storage = new Map(); const rpcCalls = [];
  let owner = 'a'; let updates = 0; let revoked = 0;
  const active = { state: 'activated', postMessage(message, ports) {
    messages.push(message);
    queueMicrotask(() => ports[0].reply({ ok: true, protocolVersion, shown: true }));
  } };
  const registration = { active, update: async () => { updates++; if (updateProtocol) protocolVersion = 2; },
    pushManager: { getSubscription: async () => ({ unsubscribe: async () => { revoked++; return true; } }) } };
  class Channel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { reply: data => this.port1.onmessage?.({ data }) };
    }
  }
  const context = { console, setTimeout, clearTimeout, queueMicrotask, MessageChannel: Channel,
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail; } },
    isSecureContext: true, PushManager: {}, Notification: { permission: 'granted' },
    navigator: { serviceWorker: { getRegistration: async () => registration } },
    document: { documentElement: { lang: 'en' } },
    window: { dispatchEvent: event => events.push(event) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    testClient: { auth: { getSession: async () => ({ data: { session: owner ? { user: { id: owner } } : null } }) },
      rpc: async (name, args) => { rpcCalls.push({ name, args }); return { error: null }; } },
  };
  vm.runInNewContext(output[0].code, context);
  const api = context.PushModule;
  return { api, messages, events, storage, rpcCalls, setSession: value => { owner = value; },
    updates: () => updates, revoked: () => revoked };
}

test('actual browser bridge unwraps FCM data, binds recipient and honors category choices', async () => {
  const h = harness(); h.api.webPush.setAccount('a');
  h.storage.set('tfleets.push.preferences.v1.a', JSON.stringify({ calls: true, messages: false }));
  await h.api.dispatchBrowserNotification({ data: { event: 'incoming_call', recipient_id: 'a', call_id: 'call-1' } });
  const sent = h.messages.filter(item => item.type === 'TFLEETS_NOTIFY');
  assert.equal(sent.length, 1); assert.equal(sent[0].payload.recipient_id, 'a'); assert.equal(sent[0].payload.call_id, 'call-1');
  assert.equal(await h.api.dispatchBrowserNotification({ event: 'chat_message', recipient_id: 'a' }), false);
  assert.equal(await h.api.dispatchBrowserNotification({ event: 'incoming_call', recipient_id: 'b' }), false);
  h.setSession('b');
  assert.equal(await h.api.dispatchBrowserNotification({ event: 'incoming_call', recipient_id: 'a' }), false);
  assert.equal(h.messages.filter(item => item.type === 'TFLEETS_NOTIFY').length, 1);
});

test('existing worker updates before v2 enable and persists independent categories after ACK', async () => {
  const h = harness({ protocolVersion: 1, updateProtocol: true });
  h.api.webPush.setAccount('a');
  assert.equal(await h.api.webPush.updatePreferences({ calls: true, messages: false }), true);
  assert.ok(h.updates() >= 1);
  const config = h.messages.find(item => item.type === 'TFLEEST_PUSH_PREFERENCES' && item.enabled);
  assert.equal(config.userId, 'a'); assert.equal(config.calls, true); assert.equal(config.messages, false);
  assert.deepEqual(JSON.parse(h.storage.get('tfleets.push.preferences.v1.a')), { calls: true, messages: false });
  assert.ok(h.events.some(event => event.type === 'tfleets-push-preferences' && event.detail.userId === 'a'));
  assert.deepEqual(h.rpcCalls.map(call => call.name), ['register_push_device', 'set_web_push_preferences']);
  assert.equal(h.rpcCalls[1].args.p_calls, true);
  assert.equal(h.rpcCalls[1].args.p_messages, false);
});

test('old worker cannot silently claim successful category configuration', async () => {
  const h = harness({ protocolVersion: 1 }); h.api.webPush.setAccount('a');
  await assert.rejects(h.api.webPush.enable(), /workerProtocol/);
  assert.equal(h.storage.has('tfleets.push.preferences.v1.a'), false);
  assert.ok(h.revoked() > 0);
});

test('close call bridge includes matching account and does not post after logout', async () => {
  const h = harness(); h.api.webPush.setAccount('a');
  await h.api.closeBrowserCallNotification('call-1');
  const close = h.messages.find(item => item.type === 'TFLEETS_CLOSE_CALL');
  assert.equal(close.userId, 'a'); assert.equal(close.callId, 'call-1');
  h.api.webPush.setAccount(null);
  assert.equal(await h.api.closeBrowserCallNotification('call-1'), false);
});
