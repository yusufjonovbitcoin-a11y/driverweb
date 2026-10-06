import { useCallback, useEffect, useState } from 'react';
import { pushOptedIn, pushPermission, pushSupported, silenceWebPush, webPush } from '../services/webPush.js';

export function useWebPush(userId, authLoading) {
  const [status, setStatus] = useState('off');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (authLoading) return undefined;
    webPush.setAccount(userId || null);
    let active = true;
    let pending = false;
    let refreshedAt = 0;
    const sync = async () => {
      if (pending) return;
      if (!pushSupported()) { setStatus('unsupported'); return; }
      if (!userId) { await silenceWebPush().catch(() => {}); setStatus('off'); return; }
      if (pushPermission() === 'denied') { setStatus('denied'); await silenceWebPush().catch(() => {}); return; }
      if (!pushOptedIn(userId) || pushPermission() !== 'granted') { setStatus('off'); return; }
      if (Date.now() - refreshedAt < 3600000) return;
      pending = true;
      if (active) setBusy(true);
      try {
        const enabled = await webPush.enable();
        if (active && enabled) { setStatus('on'); refreshedAt = Date.now(); }
      } catch { if (active) setStatus('error'); }
      finally { pending = false; if (active) setBusy(false); }
    };
    void sync();
    const focus = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('focus', focus);
    const storage = () => { refreshedAt = 0; void sync(); };
    window.addEventListener('storage', storage);
    return () => { active = false; window.removeEventListener('focus', focus); window.removeEventListener('storage', storage); };
  }, [userId, authLoading]);
  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (status === 'on') { await webPush.disable(); setStatus('off'); }
      else { if (await webPush.enable({ requestPermission: true })) setStatus('on'); }
    } catch (error) { setStatus(['denied', 'unsupported', 'off'].includes(error.message) ? error.message : 'error'); }
    finally { setBusy(false); }
  }, [busy, status]);
  const disable = useCallback(async () => {
    try { await webPush.disable(); }
    finally { await silenceWebPush().catch(() => {}); setStatus('off'); }
  }, []);
  return { status, busy, toggle, disable };
}
