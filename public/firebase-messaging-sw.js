/* Native Push API worker. No asset cache or third-party scripts.
 * Persist only account preferences and bounded delivery IDs, never message text,
 * caller names, access tokens or entire push payloads. */
const preferenceCache = 'tfleets-push-preferences-v2';
const preferenceUrl = new URL('/__tfleets_push_preferences_v2', self.location.origin).href;
const legacyCache = 'tfleest-push-preferences-v1';
const senderId = '931497947609';
const seenLimit = 160;
const seenLifetime = 24 * 60 * 60 * 1000;
const callLifetime = 120_000;
const chatLifetime = 60 * 60 * 1000;
const clockSkew = 60_000;
const callTimers = new Map();
let queue = Promise.resolve();

const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const accountOf = (data) => identifier(data?.recipient_id ?? data?.recipientId);
const safeName = (value) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
const emptyState = () => ({ version: 2, enabled: false, userId: null, calls: false, messages: false, locale: 'en', seen: [] });
function serialize(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
async function readState() {
  const cache = await caches.open(preferenceCache);
  const response = await cache.match(preferenceUrl);
  if (!response) return emptyState();
  let value;
  try { value = await response.json(); } catch { return emptyState(); }
  if (value?.version !== 2 || !identifier(value.userId)) return emptyState();
  return { version: 2, enabled: value.enabled === true, userId: value.userId,
    calls: value.calls === true, messages: value.messages === true,
    locale: ['uz', 'ru', 'en'].includes(value.locale) ? value.locale : 'en',
    seen: Array.isArray(value.seen) ? value.seen.filter((entry) =>
      entry && typeof entry.id === 'string' && entry.id.length <= 160 &&
      Number.isFinite(entry.at) && entry.at > Date.now() - seenLifetime && entry.at <= Date.now()).slice(-seenLimit) : [],
  };
}
async function writeState(state) {
  const cache = await caches.open(preferenceCache);
  await cache.put(preferenceUrl, new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }));
}
async function closeNotifications(predicate = () => true) {
  for (const notification of await self.registration.getNotifications()) {
    if (predicate(notification.data ?? {})) notification.close();
  }
}
function clearCallTimers() {
  for (const timer of callTimers.values()) clearTimeout(timer);
  callTimers.clear();
}
async function trustedWindow(event) {
  if (!event.source?.id || event.source.type !== 'window') return false;
  if (event.origin && event.origin !== self.location.origin) return false;
  const client = await self.clients.get(event.source.id);
  if (!client || client.type !== 'window') return false;
  try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
}
async function preferences(data) {
  const previous = await readState();
  const userId = identifier(data.userId);
  // An old enabled-only client cannot prove which signed-in account owns this
  // browser token. Updated account-bound preferences are required.
  const state = { version: 2, userId, enabled: data.enabled === true && Boolean(userId),
    calls: data.calls === true, messages: data.messages === true,
    locale: ['uz', 'ru', 'en'].includes(data.locale) ? data.locale : 'en',
    seen: userId && previous.userId === userId ? previous.seen : [],
  };
  await writeState(state);
  await caches.delete(legacyCache);
  if (!state.enabled || previous.userId !== state.userId) {
    clearCallTimers();
    await closeNotifications();
  } else {
    if (!state.calls) clearCallTimers();
    await closeNotifications((item) => item.userId !== state.userId ||
      (item.category === 'call' ? !state.calls : !state.messages));
  }
  return { ok: true, protocolVersion: 2 };
}
function remember(state, ids) {
  state.seen = [...state.seen.filter((entry) => !ids.includes(entry.id)),
    ...ids.map((id) => ({ id, at: Date.now() }))].slice(-seenLimit);
}
async function closeCall(callId, userId) {
  const state = await readState();
  if (!callId || !userId || state.userId !== userId) return { ok: true, shown: false, reason: 'account_mismatch' };
  clearTimeout(callTimers.get(callId));
  callTimers.delete(callId);
  // Ended-before-incoming must also suppress an out-of-order delayed ring.
  remember(state, ['call:' + callId]);
  await writeState(state);
  await closeNotifications((item) => item.userId === userId && item.callId === callId);
  return { ok: true };
}
const copy = {
  en: { call: 'Incoming Call', message: 'New Message', other: 'Notification',
    calling: (name) => name ? name + ' is calling' : 'Someone is calling',
    messageBody: (name) => name ? 'New message from ' + name + '. Open T Fleets to view it.' : 'You have a new message. Open T Fleets to view it.',
    otherBody: 'Open T Fleets to view your notification.', callTest: 'Call notification test', messageTest: 'Message notification test',
    testBody: 'This is a test notification from T Fleets.' },
  ru: { call: 'Входящий звонок', message: 'Новое сообщение', other: 'Уведомление',
    calling: (name) => name ? name + ' звонит' : 'Вам звонят',
    messageBody: (name) => name ? 'Новое сообщение от ' + name + '. Откройте T Fleets.' : 'У вас новое сообщение. Откройте T Fleets.',
    otherBody: 'Откройте T Fleets, чтобы посмотреть уведомление.', callTest: 'Проверка уведомлений о звонках', messageTest: 'Проверка уведомлений о сообщениях',
    testBody: 'Это тестовое уведомление T Fleets.' },
  uz: { call: 'Kiruvchi qo‘ng‘iroq', message: 'Yangi xabar', other: 'Bildirishnoma',
    calling: (name) => name ? name + ' qo‘ng‘iroq qilyapti' : 'Sizga qo‘ng‘iroq bo‘lyapti',
    messageBody: (name) => name ? name + 'dan yangi xabar. T Fleets’ni oching.' : 'Sizda yangi xabar bor. T Fleets’ni oching.',
    otherBody: 'Bildirishnomani ko‘rish uchun T Fleets’ni oching.', callTest: 'Qo‘ng‘iroq bildirishnomasi sinovi', messageTest: 'Xabar bildirishnomasi sinovi',
    testBody: 'Bu T Fleets sinov bildirishnomasi.' },
};
async function deliver(payload, forwarded = false) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: true, shown: false, reason: 'invalid_payload' };
  if (data.test && !forwarded) return { ok: true, shown: false, reason: 'remote_test' };
  const state = await readState();
  const userId = accountOf(data);
  if (!userId || userId !== state.userId) return { ok: true, shown: false, reason: 'account_mismatch' };
  const callId = identifier(data.call_id ?? data.callId);
  if (data.event === 'call_ended') return closeCall(callId, userId);
  if (!state.enabled) return { ok: true, shown: false, reason: 'disabled' };
  const isCall = data.event === 'incoming_call' || data.entityType === 'chat_call' || data.entity_type === 'chat_call';
  const isChat = isCall || data.event === 'chat_message' || data.type === 'chat_message' ||
    data.entityType === 'chat_conversation' || data.entity_type === 'chat_conversation';
  if (isCall ? !state.calls : !state.messages) return { ok: true, shown: false, reason: 'category_disabled' };
  if (!forwarded && isChat && !isCall) {
    const created = data.created_at ?? data.createdAt;
    const createdAt = typeof created === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(created) ? Date.parse(created) : NaN;
    if (!Number.isFinite(createdAt) || createdAt < Date.now() - chatLifetime || createdAt > Date.now() + clockSkew) {
      return { ok: true, shown: false, reason: 'stale_message' };
    }
  }
  let expiresAt = null;
  if (isCall) {
    expiresAt = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
    if (!callId || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 2_000 || expiresAt > Date.now() + callLifetime) {
      return { ok: true, shown: false, reason: 'expired_call' };
    }
  }
  const messageId = identifier(data.chat_message_id ?? data.chatMessageId ?? data.message_id ?? data.messageId);
  const notificationId = identifier(data.notificationId ?? data.notification_id);
  const ids = isCall ? ['call:' + callId] : [messageId && 'message:' + messageId, notificationId && 'notification:' + notificationId].filter(Boolean);
  if (!ids.length) return { ok: true, shown: false, reason: 'missing_id' };
  if (ids.some((id) => state.seen.some((entry) => entry.id === id))) {
    // Learn the other channel's alias too (message ID vs notification ID).
    remember(state, ids);
    await writeState(state);
    return { ok: true, shown: false, reason: 'duplicate' };
  }
  const words = copy[state.locale];
  const test = forwarded && data.test === true;
  const title = 'T Fleets — ' + (test ? (isCall ? words.callTest : words.messageTest) : isCall ? words.call : isChat ? words.message : words.other);
  const body = test ? words.testBody : isCall ? words.calling(safeName(data.caller_name))
    : isChat ? words.messageBody(safeName(data.sender_name ?? data.senderName)) : words.otherBody;
  // Provider title/body and URLs are never used; they may contain private text.
  await self.registration.showNotification(title, { body, icon: '/favicon.svg',
    tag: 'tfleets-' + state.userId + '-' + ids[0], renotify: false, requireInteraction: false,
    data: { userId, category: isCall ? 'call' : 'message', route: isChat ? 'chat' : 'inbox',
      callId: isCall ? callId : null, expiresAt,
      conversationId: identifier(data.conversation_id ?? data.conversationId ?? (isChat ? data.entityId : null)) },
  });
  remember(state, ids);
  await writeState(state);
  if (isCall) {
    // Best effort while alive; call_ended and activation also clear stale UI.
    // The browser/OS ultimately controls worker suspension and banner lifetime.
    const timer = setTimeout(() => {
      callTimers.delete(callId);
      void serialize(() => closeNotifications((item) => item.userId === userId && item.callId === callId)).catch(() => {});
    }, Math.max(0, expiresAt - Date.now()));
    callTimers.set(callId, timer);
  }
  return { ok: true, shown: true };
}

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => {
  event.waitUntil(serialize(async () => {
    const state = await readState();
    await caches.delete(legacyCache);
    await closeNotifications((item) => !state.enabled || item.userId !== state.userId ||
      (item.category === 'call' && (!state.calls || !item.expiresAt || item.expiresAt <= Date.now())) ||
      (item.category !== 'call' && !state.messages));
  }).catch(() => {}));
});
self.addEventListener('message', (event) => {
  if (!['TFLEEST_PUSH_PREFERENCES', 'TFLEETS_NOTIFY', 'TFLEETS_CLOSE_CALL'].includes(event.data?.type)) return;
  event.waitUntil(serialize(async () => {
    if (!await trustedWindow(event)) return { ok: false, error: 'untrusted_source' };
    if (event.data.type === 'TFLEEST_PUSH_PREFERENCES') return preferences(event.data);
    if (event.data.type === 'TFLEETS_CLOSE_CALL') return closeCall(identifier(event.data.callId), identifier(event.data.userId));
    return deliver(event.data.payload, true);
  }).then((result) => event.ports?.[0]?.postMessage(result), () => {
    event.ports?.[0]?.postMessage({ ok: false, error: 'notification_unavailable' });
  }));
});
self.addEventListener('push', (event) => {
  event.waitUntil(serialize(async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (String(payload?.from) !== senderId) return;
    await deliver(payload);
  }).catch(() => {}));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(serialize(async () => {
    const state = await readState();
    const data = event.notification.data ?? {};
    if (!state.enabled || !state.userId || data.userId !== state.userId) return;
    if (data.category === 'call' ? !state.calls || !data.expiresAt || data.expiresAt <= Date.now() : !state.messages) return;
    const route = data.route === 'chat' ? 'chat' : 'inbox';
    const target = new URL('/#' + route, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => { try { return new URL(client.url).origin === self.location.origin; } catch { return false; } });
    if (existing) {
      const navigated = existing.url === target ? existing : await existing.navigate(target);
      await (navigated ?? existing).focus();
    } else await self.clients.openWindow(target);
    // Opening chat never accepts a call: the app validates its current state.
  }).catch(() => {}));
});
