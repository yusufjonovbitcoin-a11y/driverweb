import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatchBrowserNotification, getPushPreferences, pushPermission, pushSupported, silenceWebPush, webPush } from '../services/webPush.js';
import { emptyPushPreferences, hasPushCategory, legacyPushPreferenceKey, pushFailureReason, pushPreferencesEvent, pushPreferencesKey } from '../services/webPushPreferences.js';

export function useWebPush(userId, authLoading) {
  const [status, setStatus] = useState('off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testSuccess, setTestSuccess] = useState(null);
  const [preferences, setPreferences] = useState(emptyPushPreferences);
  const ownerRef = useRef(userId);
  const busyRef = useRef(false);
  const operationRef = useRef(0);
  const queuedSyncRef = useRef(false);
  const syncRef = useRef(null);
  const finishOperation = useCallback((operation) => {
    if (operation !== operationRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (queuedSyncRef.current) { queuedSyncRef.current = false; void syncRef.current?.(true); }
  }, []);
  useEffect(() => {
    ownerRef.current = authLoading ? null : userId;
    webPush.setAccount(ownerRef.current || null);
    if (authLoading) return undefined;
    operationRef.current += 1;
    busyRef.current = false;
    // oxlint-disable-next-line react/set-state-in-effect -- Reset account-bound external registration state.
    setBusy(false);
    setError(null);
    setTestSuccess(null);
    let active = true;
    let pending = false;
    let refreshedAt = 0;
    const sync = async (force = false) => {
      if (!active) return;
      if (pending || busyRef.current) { if (force) queuedSyncRef.current = true; return; }
      const saved = getPushPreferences(userId);
      setPreferences(saved);
      if (!pushSupported()) { setStatus('unsupported'); return; }
      if (!userId) { await silenceWebPush().catch(() => {}); setStatus('off'); return; }
      if (pushPermission() === 'denied') { setStatus('denied'); await silenceWebPush(userId).catch(() => {}); return; }
      if (hasPushCategory(saved) && pushPermission() !== 'granted') { setStatus('off'); await silenceWebPush(userId).catch(() => {}); return; }
      if (!force && Date.now() - refreshedAt < 3600000) return;
      pending = true;
      busyRef.current = true;
      const operation = ++operationRef.current;
      if (active) setBusy(true);
      try {
        const enabled = await webPush.refresh();
        if (active && enabled) {
          const latest = getPushPreferences(userId);
          setPreferences(latest); setStatus(hasPushCategory(latest) ? 'on' : 'off'); setError(null); refreshedAt = Date.now();
        }
      } catch (failure) { if (active) { setStatus('error'); setError(pushFailureReason(failure)); } }
      finally {
        pending = false;
        if (active) finishOperation(operation);
      }
    };
    syncRef.current = sync;
    void sync();
    const focus = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('focus', focus);
    const storage = (event) => {
      if (event.key !== null && ![pushPreferencesKey(userId), legacyPushPreferenceKey(userId)].includes(event.key)) return;
      refreshedAt = 0; void sync(true);
    };
    const local = (event) => { if (event.detail?.userId === userId) setPreferences(getPushPreferences(userId)); };
    window.addEventListener('storage', storage);
    window.addEventListener(pushPreferencesEvent, local);
    return () => { active = false; if (syncRef.current === sync) syncRef.current = null; window.removeEventListener('focus', focus); window.removeEventListener('storage', storage); window.removeEventListener(pushPreferencesEvent, local); };
  }, [userId, authLoading, finishOperation]);
  const toggleCategory = useCallback(async (category) => {
    if (!['calls', 'messages'].includes(category) || busyRef.current || !userId) return;
    const owner = userId;
    const saved = getPushPreferences(owner);
    const next = { ...saved, [category]: !saved[category] };
    busyRef.current = true; setBusy(true); setError(null); setTestSuccess(null);
    const operation = ++operationRef.current;
    try {
      const savedSuccessfully = await webPush.updatePreferences(next, { requestPermission: next[category], category });
      if (ownerRef.current === owner && savedSuccessfully) { const latest = getPushPreferences(owner); setPreferences(latest); setStatus(hasPushCategory(latest) ? 'on' : 'off'); }
    } catch (failure) {
      if (ownerRef.current === owner) { const reason = pushFailureReason(failure); setStatus(['denied', 'unsupported', 'off'].includes(reason) ? reason : 'error'); setError(reason); }
    } finally { finishOperation(operation); }
  }, [userId, finishOperation]);
  const disable = useCallback(async () => {
    const owner = ownerRef.current;
    busyRef.current = true; setBusy(true); setError(null); setTestSuccess(null);
    const operation = ++operationRef.current;
    const current = () => ownerRef.current === owner && operationRef.current === operation;
    try {
      await webPush.disable();
      if (current()) {
        setPreferences(emptyPushPreferences);
        setStatus(!pushSupported() ? 'unsupported' : pushPermission() === 'denied' ? 'denied' : 'off');
      }
    } catch (failure) { if (current()) setError(pushFailureReason(failure)); throw failure; }
    finally { finishOperation(operation); }
  }, [finishOperation]);
  const testNotification = useCallback(async (category) => {
    if (!['calls', 'messages'].includes(category) || busyRef.current || !userId) return;
    const owner = userId;
    busyRef.current = true; setBusy(true); setError(null); setTestSuccess(null);
    const operation = ++operationRef.current;
    try {
      const id = `test-${crypto.randomUUID()}`;
      const result = await dispatchBrowserNotification({ test: true, recipient_id: owner,
        event: category === 'calls' ? 'incoming_call' : 'chat_message', notification_id: id,
        ...(category === 'calls' ? { call_id: id, expires_at: new Date(Date.now() + 30_000).toISOString() } : {}) });
      if (!result?.shown) throw new Error('testFailed');
      if (ownerRef.current === owner) setTestSuccess(category);
    } catch (failure) { if (ownerRef.current === owner) setError(pushFailureReason(failure, 'testFailed')); }
    finally { finishOperation(operation); }
  }, [userId, finishOperation]);
  return { status, busy, preferences, error, testSuccess, toggleCategory, testNotification, disable };
}
