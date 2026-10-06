/* Native Push API worker: FCM registration is handled by the client SDK.
 * No asset caching, no third-party scripts, no chat text on the lock screen.
 * This separate scope never controls the application's network requests. */
const preferenceCache = 'tfleest-push-preferences-v1';
const preferenceUrl = new URL('/__tfleest_push_preferences', self.location.origin).href;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'TFLEEST_PUSH_PREFERENCES') return;
  event.waitUntil((async () => {
    const cache = await caches.open(preferenceCache);
    await cache.put(preferenceUrl, new Response(JSON.stringify({
      enabled: event.data.enabled === true,
      locale: ['uz', 'ru', 'en'].includes(event.data.locale) ? event.data.locale : 'en',
    })));
    if (!event.data.enabled) {
      for (const notification of await self.registration.getNotifications()) notification.close();
    }
    event.ports[0]?.postMessage({ ok: true });
  })());
});
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (String(payload?.from) !== '931497947609') return;
    const cache = await caches.open(preferenceCache);
    const response = await cache.match(preferenceUrl);
    const preferences = response ? await response.json() : {};
    if (!preferences.enabled) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const chat = payload.data?.entityType === 'chat_conversation' || payload.data?.entityType === 'chat_call';
    const route = chat ? 'chat' : 'inbox';
    // Realtime already renders messages in the open chat. Do not duplicate them.
    if (windows.some((client) => client.visibilityState === 'visible' && new URL(client.url).hash === `#${route}`)) return;
    const body = { uz: 'Yangi bildirishnoma. Ko‘rish uchun saytni oching.',
      ru: 'Новое уведомление. Откройте сайт, чтобы посмотреть.',
      en: 'New notification. Open the website to view it.' }[preferences.locale] || 'New notification';
    await self.registration.showNotification('T Fleest', {
      body, icon: '/drivex.svg', tag: `tfleest-${payload.data?.notificationId || 'new'}`,
      data: { route },
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    // Never follow arbitrary URLs from a push payload.
    const route = event.notification.data?.route === 'chat' ? 'chat' : 'inbox';
    const target = new URL(`/#${route}`, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); await existing.focus(); }
    else await self.clients.openWindow(target);
  })());
});
