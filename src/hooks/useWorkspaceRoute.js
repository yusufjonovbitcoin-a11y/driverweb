import { useCallback, useState, useSyncExternalStore } from 'react';
import { confirmSettingsNavigation, pushSettingsHistory } from './useSettingsDraft.js';

const navigationEvents = ['popstate', 'hashchange', 'settings:navigated'];

function subscribe(onChange) {
  navigationEvents.forEach(event => window.addEventListener(event, onChange));
  return () => navigationEvents.forEach(event => window.removeEventListener(event, onChange));
}

function readRoute() {
  const [page, query] = window.location.hash.slice(1).split('?', 2);
  return { page, query };
}

export function workspaceHash(page, values) {
  const params = new URLSearchParams(values);
  return params.size ? `#${page}?${params}` : `#${page}`;
}

export function updateWorkspaceRoute(page, changes) {
  const current = readRoute();
  if (current.page !== page) return false;
  const params = new URLSearchParams(current.query);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const hash = workspaceHash(page, params);
  if (hash === window.location.hash) return true;
  if (!confirmSettingsNavigation()) return false;
  pushSettingsHistory(hash);
  return true;
}

export function useWorkspaceParams(page) {
  const getQuery = useCallback(() => {
    const current = readRoute();
    return current.page === page ? current.query || '' : '';
  }, [page]);
  const query = useSyncExternalStore(page ? subscribe : ignoreSubscription, getQuery, emptyQuery);
  return new URLSearchParams(query);
}

const emptyQuery = () => '';
const ignoreSubscription = () => () => {};

// Shared screens keep local navigation when embedded outside the workspace.
export function useWorkspaceSelection(page, key, initialValue, options) {
  const params = useWorkspaceParams(page);
  const [localValue, setLocalValue] = useState(initialValue);
  const routedValue = params.get(key);
  const value = page ? (routedValue && (!options || options.includes(routedValue)) ? routedValue : initialValue) : localValue;
  const select = useCallback((next, related) => {
    if (!page) { setLocalValue(next); return true; }
    return updateWorkspaceRoute(page, { ...related, [key]: next === initialValue ? null : next });
  }, [page, key, initialValue]);
  return [value, select];
}
