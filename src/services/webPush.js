import { supabase } from '../lib/supabase.js';
import { firebaseVapidKey, getFirebaseApp } from './firebaseConfig.js';
import { createWebPushController } from './webPushController.js';

const scope = '/firebase-push/';
const tokenKey = 'tfleest.push.token';
const preferenceKey = (id) => `tfleest.push.enabled.${id}`;
let messagingPromise;
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
export const pushOptedIn = (id) => !!id && read(preferenceKey(id)) === 'true';
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
  if (!registered) return null;
  if (registered.active?.state === 'activated') return registered;
  const worker = registered.installing || registered.waiting || registered.active;
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
async function setWorkerEnabled(enabled) {
  const registered = await registration(enabled);
  if (!registered?.active) return;
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('workerTimeout')); }, 5000);
    channel.port1.onmessage = () => { clearTimeout(timeout); channel.port1.close(); resolve(); };
    registered.active.postMessage({ type: 'TFLEEST_PUSH_PREFERENCES', enabled,
      locale: document.documentElement.lang.split('-')[0] }, [channel.port2]);
  });
}
async function rpc(name, args) {
  if (!supabase) throw new Error('signedOut');
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error('registrationFailed');
}
export const webPush = createWebPushController({
  lock: (fn) => navigator.locks ? navigator.locks.request('tfleest-push', fn) : fn(),
  permission: pushPermission,
  requestPermission: () => pushSupported() ? Notification.requestPermission() : Promise.reject(new Error('unsupported')),
  readToken: () => read(tokenKey),
  saveToken: (token) => write(tokenKey, token),
  saveEnabled: (id, value) => { if (id) { try { write(preferenceKey(id), String(value)); } catch { /* Session-only preference if storage is blocked. */ } } },
  sessionUserId: async () => (await supabase.auth.getSession()).data.session?.user.id,
  setWorkerEnabled,
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
  register: (token) => rpc('register_push_device', { token, platform: 'web' }),
  unregister: (token) => rpc('unregister_push_device', { token }),
});
export const silenceWebPush = () => setWorkerEnabled(false);
