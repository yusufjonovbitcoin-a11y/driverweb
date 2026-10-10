import { supabase } from '../lib/supabase.js';
import { firebaseVapidKey, getFirebaseApp } from './firebaseConfig.js';
import { createWebPushController } from './webPushController.js';
import { emptyPushPreferences, hasPushCategory, legacyPushPreferenceKey, normalizePushPreferences, pushPreferencesEvent, pushPreferencesKey, readPushPreferences, withPushDeadline } from './webPushPreferences.js';

const scope = '/firebase-push/';
const tokenKey = 'tfleest.push.token';
let currentAccount = null;
let messagingPromise;
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
export const getPushPreferences = (id) => readPushPreferences(id, read);
export const pushOptedIn = (id) => hasPushCategory(getPushPreferences(id));
export const pushPermission = () => globalThis.Notification?.permission || 'unsupported';
export function pushSupported() {
  return !!(globalThis.isSecureContext && globalThis.Notification && navigator.serviceWorker && globalThis.PushManager);
}
async function messaging() {
  messagingPromise ??= (async () => {
    const sdk = await import('firebase/messaging');
    if (!await sdk.isSupported()) throw new Error('unsupported');
    return { sdk, instance: sdk.getMessaging(await getFirebaseApp()) };
  })().catch((error) => { messagingPromise = undefined; throw error; });
  return messagingPromise;
}
async function registration(create = false) {
  if (!navigator.serviceWorker) return null;
  let registered = await navigator.serviceWorker.getRegistration(scope);
  if (!registered && create) registered = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope, updateViaCache: 'none' });
  else if (registered && create) await registered.update();
  if (!registered) return null;
  const worker = registered.installing || registered.waiting || registered.active;
  if (worker?.state === 'activated') return registered;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('workerTimeout')); }, 15000);
    const cleanup = () => { clearTimeout(timeout); worker?.removeEventListener('statechange', check); };
    const check = () => {
      if (worker?.state === 'activated') { cleanup(); resolve(); }
      else if (worker?.state === 'redundant') { cleanup(); reject(new Error('workerFailed')); }
    };
    worker?.addEventListener('statechange', check);
    check();
  });
  return registered;
}
async function sendWorkerMessage(message, create = false) {
  const registered = await registration(create);
  if (!registered?.active) {
    if (create) throw new Error('workerFailed');
    return;
  }
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('workerTimeout')); }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout); channel.port1.close();
      if (event.data?.ok !== true) reject(new Error('workerFailed'));
      else if (message.type === 'TFLEEST_PUSH_PREFERENCES' && event.data?.protocolVersion !== 2) reject(new Error('workerProtocol'));
      else resolve(event.data);
    };
    registered.active.postMessage(message, [channel.port2]);
  });
}
const setWorkerPreferences = (preferences) => sendWorkerMessage({ type: 'TFLEEST_PUSH_PREFERENCES',
  ...preferences, locale: document.documentElement.lang.split('-')[0] }, preferences.enabled);
async function rpc(name, args) {
  if (!supabase) throw new Error('signedOut');
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error('registrationFailed');
}
const controller = createWebPushController({
  lock: async (fn) => {
    if (!navigator.locks) return fn();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    try { return await navigator.locks.request('tfleest-push', { signal: abort.signal }, fn); }
    catch (error) { if (abort.signal.aborted) throw new Error('workerTimeout'); throw error; }
    finally { clearTimeout(timer); }
  },
  readPreferences: getPushPreferences,
  permission: pushPermission,
  requestPermission: () => pushSupported() ? Notification.requestPermission() : Promise.reject(new Error('unsupported')),
  readToken: () => read(tokenKey),
  saveToken: (token) => write(tokenKey, token),
  savePreferences: (id, value) => {
    if (!id) return;
    write(pushPreferencesKey(id), JSON.stringify(normalizePushPreferences(value)));
    try { write(legacyPushPreferenceKey(id), null); } catch { /* New version takes precedence. */ }
    window.dispatchEvent(new CustomEvent(pushPreferencesEvent, { detail: { userId: id } }));
  },
  sessionUserId: async () => (await supabase?.auth.getSession())?.data.session?.user.id,
  setWorkerPreferences,
  getToken: async () => {
    if (!firebaseVapidKey) throw new Error('registrationFailed');
    const { sdk, instance } = await messaging();
    // Existing server worker uses FCM token addressing, not installation IDs.
    const token = await sdk.getToken(instance, { vapidKey: firebaseVapidKey, serviceWorkerRegistration: await registration(true) });
    if (!token) throw new Error('registrationFailed');
    return token;
  },
  deleteToken: async () => {
    const registered = await registration();
    if (!registered) return;
    // Revoke the actual browser endpoint without accessing private Firebase SDK
    // fields or creating a new subscription just to delete it. getToken validates
    // cached subscription details on the next opt-in and replaces its stale token.
    const subscription = await registered.pushManager.getSubscription();
    if (subscription && !await subscription.unsubscribe()) throw new Error('disableFailed');
  },
  register: async (token, preferences) => {
    await rpc('register_push_device', { token, platform: 'web' });
    await rpc('set_web_push_preferences', { p_token: token,
      p_calls: preferences.calls === true, p_messages: preferences.messages === true });
  },
  unregister: (token) => rpc('unregister_push_device', { token }),
});
export const webPush = { ...controller, setAccount(id) { currentAccount = id; controller.setAccount(id); } };
export const silenceWebPush = (userId = null) => setWorkerPreferences({ ...emptyPushPreferences, enabled: false, userId });

export async function dispatchBrowserNotification(payload) {
  payload = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const owner = currentAccount;
  const recipient = payload?.recipient_id ?? payload?.recipientId ?? owner;
  if (!owner || recipient !== owner || pushPermission() !== 'granted') return false;
  const category = payload?.event === 'incoming_call' ? 'calls' : 'messages';
  if (!getPushPreferences(owner)[category]) return false;
  const sessionId = (await withPushDeadline(supabase?.auth.getSession()))?.data.session?.user.id;
  if (currentAccount !== owner || sessionId !== owner) return false;
  return sendWorkerMessage({ type: 'TFLEETS_NOTIFY', payload: { ...payload, recipient_id: owner } });
}
export async function closeBrowserCallNotification(callId) {
  if (!currentAccount || !callId) return false;
  return sendWorkerMessage({ type: 'TFLEETS_CLOSE_CALL', callId, userId: currentAccount });
}
