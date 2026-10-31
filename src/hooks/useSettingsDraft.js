import { useEffect, useId, useRef } from 'react';

// Drafts stay in memory. In particular, passwords must never enter browser storage.
const drafts = new Map();
let navigationApproved = false;
export function confirmSettingsNavigation() {
  if (navigationApproved) return true;
  const current = [...drafts.values()].map(read => read());
  if (current.some(value => value.busy)) return false;
  const dirty = current.find(value => value.dirty);
  if (dirty && !window.confirm(dirty.message)) return false;
  if (dirty) {
    navigationApproved = true;
    queueMicrotask(() => { navigationApproved = false; });
  }
  return true;
}

export function pushSettingsHistory(hash) {
  const index = Number.isInteger(window.history.state?.settingsIndex) ? window.history.state.settingsIndex : 0;
  window.history.pushState({ ...window.history.state, settingsIndex: index + 1 }, '', hash);
  window.dispatchEvent(new Event('settings:navigated'));
}

export function useSettingsHistoryGuard() {
  useEffect(() => {
    if (!Number.isInteger(window.history.state?.settingsIndex)) window.history.replaceState({ ...window.history.state, settingsIndex: 0 }, '');
    let acceptedHash = window.location.hash;
    let acceptedIndex = window.history.state.settingsIndex;
    let restoring = false;
    const checkpoint = () => { acceptedHash = window.location.hash; acceptedIndex = window.history.state?.settingsIndex; };
    const guard = event => {
      if (restoring) {
        if (window.location.hash !== acceptedHash) { event.stopImmediatePropagation(); return; }
        restoring = false;
      }
      if (window.location.hash === acceptedHash) return;
      if (confirmSettingsNavigation()) { checkpoint(); return; }
      event.stopImmediatePropagation();
      const targetIndex = window.history.state?.settingsIndex;
      if (Number.isInteger(targetIndex) && Number.isInteger(acceptedIndex) && targetIndex !== acceptedIndex) {
        restoring = true;
        window.history.go(acceptedIndex - targetIndex);
      } else window.history.replaceState(window.history.state, '', acceptedHash || window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', guard, true);
    window.addEventListener('hashchange', guard, true);
    window.addEventListener('settings:navigated', checkpoint);
    return () => {
      window.removeEventListener('popstate', guard, true);
      window.removeEventListener('hashchange', guard, true);
      window.removeEventListener('settings:navigated', checkpoint);
    };
  }, []);
}

export function useSettingsDraft(dirty, busy, message) {
  const id = useId();
  const state = useRef(null);
  useEffect(() => { state.current = { dirty: Boolean(dirty), busy: Boolean(busy), message }; });
  useEffect(() => {
    if (!dirty && !busy) return undefined;
    drafts.set(id, () => state.current);
    const warn = event => {
      if (!state.current.dirty && !state.current.busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => { drafts.delete(id); window.removeEventListener('beforeunload', warn); };
  }, [id, dirty, busy]);
}
