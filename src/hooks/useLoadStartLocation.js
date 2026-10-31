import { useEffect, useState } from 'react';
import { requireSupabase } from '../lib/supabase';
import { fetchLoadStartLocation } from '../services/loadStartLocation.js';

export function useLoadStartLocation(load, driver) {
  const loadId = load.id, assignmentId = load.currentAssignmentId, driverId = driver?.id;
  const enabled = Boolean(loadId && assignmentId && driverId && driverId === load.driverId);
  const departed = ['in_progress', 'completed', 'delivered', 'cancelled', 'dispute'].includes(load.databaseStatus);
  const key = JSON.stringify([loadId, assignmentId, driverId]);
  const [snapshot, setSnapshot] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true, busy = false, queued = false, ready = false, controller, channel;
    const client = requireSupabase();
    const visible = () => document.visibilityState !== 'hidden';
    const refresh = async () => {
      if (!active || !visible()) return;
      if (busy) { queued = true; return; }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const data = await fetchLoadStartLocation(client, { loadId, assignmentId, driverId }, controller.signal);
        if (data.status === 'awaiting_start' && departed) data.status = 'missing_location';
        if (active) { ready = data.status === 'ready'; setSnapshot({ key, ...data }); }
      } catch {
        if (active) { ready = false; setSnapshot({ key, status: 'error', location: null }); }
      } finally {
        clearTimeout(timeout); busy = false;
        if (active && queued) { queued = false; void refresh(); }
      }
    };
    void refresh();
    try {
      channel = client.channel(`load-start:${assignmentId}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_snapshots', filter: `load_id=eq.${loadId}` }, refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assignments', filter: `id=eq.${assignmentId}` }, refresh)
        .subscribe();
    } catch { /* Focus and bounded polling cover a disconnected Realtime client. */ }
    const timer = setInterval(() => { if (!ready) void refresh(); }, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false; controller?.abort(); clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (channel) void client.removeChannel(channel);
    };
  }, [enabled, loadId, assignmentId, driverId, key, load.version, departed, attempt]);
  return { ...(enabled ? snapshot?.key === key ? snapshot : { status: 'loading', location: null }
    : { status: 'awaiting_start', location: null }), retry: () => setAttempt(value => value + 1) };
}
