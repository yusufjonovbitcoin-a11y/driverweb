const MESSAGE_MAX_AGE_MS = 5 * 60_000;
const CALL_LIFETIME_MS = 90_000;
const MAX_REMEMBERED_EVENTS = 300;

// Realtime is the low-latency path while the page is open. The service worker
// shares stable IDs with FCM, so an eventual server push cannot show a duplicate.
export function createBrowserNotificationReceiver({ userId, send, closeCall, resolveCaller, now = Date.now }) {
  let active = true;
  const messages = new Map();
  const calls = new Map();
  const remember = (map, key, value) => {
    map.set(key, value);
    if (map.size > MAX_REMEMBERED_EVENTS) map.delete(map.keys().next().value);
  };
  const eligible = row => active && userId && row?.recipient_id === userId && row?.id;

  async function onNotification(row) {
    if (!eligible(row) || row.type !== 'chat_message' || row.read_at || row.chat_message?.read_at || row.chat_message?.deleted_at || row.entity_type !== 'chat_conversation') return;
    const age = now() - Date.parse(row.created_at);
    if (!Number.isFinite(age) || age < -60_000 || age > MESSAGE_MAX_AGE_MS || messages.has(row.id)) return;
    remember(messages, row.id, true);
    try {
      const shown = await send({
        data: {
          type: 'chat_message', entityType: 'chat_conversation',
          notificationId: row.id, chatMessageId: row.chat_message_id || '',
          entityId: row.entity_id, conversationId: row.entity_id,
          recipient_id: userId, created_at: row.created_at,
        },
      });
      if (shown === false) messages.delete(row.id);
    } catch { messages.delete(row.id); }
  }

  async function onCall(row) {
    if (!eligible(row)) return;
    if (row.status !== 'ringing') {
      remember(calls, row.id, { terminal: true });
      try { await closeCall(row.id); } catch { /* The push path also closes terminal calls. */ }
      return;
    }
    if (calls.has(row.id)) return;
    const expiresAt = Date.parse(row.started_at) + CALL_LIFETIME_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt > now() + CALL_LIFETIME_MS + 60_000) return;
    const attempt = {};
    remember(calls, row.id, attempt);
    try {
      const callerName = row.caller_name || await resolveCaller?.(row.initiator_id) || '';
      // A call may end (or the user may sign out) during the profile lookup.
      if (!active || calls.get(row.id) !== attempt || expiresAt <= now()) return;
      const shown = await send({ data: {
        event: 'incoming_call', call_id: row.id, recipient_id: userId,
        caller_name: callerName, conversation_id: row.conversation_id,
        started_at: row.started_at, expires_at: new Date(expiresAt).toISOString(),
      } });
      if (shown === false && calls.get(row.id) === attempt) calls.delete(row.id);
    } catch { if (calls.get(row.id) === attempt) calls.delete(row.id); }
  }

  return { onNotification, onCall, dispose() { active = false; messages.clear(); calls.clear(); } };
}
