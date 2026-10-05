// Framework-independent transport wiring: tests exercise the same callbacks as production.
export function createChatSubscription(client, { conversationId, onMessage, onMessageUpdated, onStatus, onReconnect }) {
  let settled = false;
  let connected = false;
  let closed = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const channel = client.channel(`chat:${conversationId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` }, ({ new: row }) => { if (!closed) onMessage?.(row); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` }, ({ new: row }) => { if (!closed) onMessageUpdated?.(row); })
    .subscribe((status) => {
      if (closed) return;
      onStatus?.(status);
      if (status === 'SUBSCRIBED') {
        const recovered = !connected && settled;
        connected = true;
        if (!settled) { settled = true; resolveReady(); }
        else if (recovered) onReconnect?.();
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        connected = false;
        if (!settled) { settled = true; rejectReady(new Error('CHAT_REALTIME_UNAVAILABLE')); }
      }
    });
  return { ready, unsubscribe() { closed = true; return client.removeChannel(channel); } };
}

export class ChatSearchScope {
  constructor() { this.generation = 0; this.key = null; }
  select(key) { if (this.key !== key) { this.key = key; this.generation++; } }
  capture() { const generation = this.generation; return () => generation === this.generation; }
  cancel() { this.generation++; }
}
