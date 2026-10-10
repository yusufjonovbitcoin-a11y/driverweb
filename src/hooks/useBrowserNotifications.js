import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { createBrowserNotificationReceiver } from '../services/browserNotificationReceiver';
import { closeBrowserCallNotification, dispatchBrowserNotification } from '../services/webPush';

// Mounted at account scope, not inside Chat: notifications work on every page.
export function useBrowserNotifications(userId, enabled) {
  useEffect(() => {
    if (!supabase || !userId || !enabled) return undefined;
    let active = true;
    let refreshing = false;
    const startedAt = Date.now();
    const names = new Map();
    const receiver = createBrowserNotificationReceiver({
      userId,
      send: async payload => (await dispatchBrowserNotification(payload))?.shown === true,
      closeCall: closeBrowserCallNotification,
      resolveCaller: async id => {
        if (!id) return '';
        if (names.has(id)) return names.get(id);
        const { data, error } = await supabase.from('profiles').select('full_name').eq('id', id).maybeSingle();
        if (!error && data?.full_name) names.set(id, data.full_name);
        return data?.full_name || '';
      },
    });
    const refresh = async () => {
      if (!active || refreshing) return;
      refreshing = true;
      try {
        // Reconnect catches only recent events from this listening session, not
        // a backlog of old unread messages. RLS still checks the recipient.
        const since = new Date(Math.max(startedAt, Date.now() - 5 * 60_000)).toISOString();
        const [notifications, calls] = await Promise.all([
          supabase.from('notifications')
            .select('id,recipient_id,type,entity_type,entity_id,chat_message_id,read_at,created_at,chat_message:chat_messages(read_at,deleted_at)')
            .eq('recipient_id', userId).eq('type', 'chat_message').is('read_at', null)
            .gte('created_at', since).order('created_at', { ascending: false }).limit(100),
          supabase.rpc('get_incoming_chat_calls'),
        ]);
        if (!active) return;
        if (!notifications.error) for (const row of notifications.data || []) void receiver.onNotification(row);
        if (!calls.error) for (const row of calls.data || []) void receiver.onCall(row);
      } catch { /* Realtime, periodic reconciliation and push are independent paths. */ }
      finally { refreshing = false; }
    };
    const channel = supabase.channel(`browser-notifications:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        ({ new: row }) => { void receiver.onNotification(row); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_calls', filter: `recipient_id=eq.${userId}` },
        ({ new: row }) => { void receiver.onCall(row); })
      .subscribe(status => { if (status === 'SUBSCRIBED') void refresh(); });
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      receiver.dispose();
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
      void supabase.removeChannel(channel);
    };
  }, [userId, enabled]);
}
