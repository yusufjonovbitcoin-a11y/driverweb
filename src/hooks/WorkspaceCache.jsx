import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import useSWR, { SWRConfig, unstable_serialize, useSWRConfig } from 'swr';

const ViewCache = createContext(null);

// Mounted above routes, but keyed by authenticated user/company/role in App.
// Private data lives only in memory: never persist inbox or GPS data to disk.
export function WorkspaceCache({ children }) {
  const [views] = useState(() => new Map());
  const [freshness] = useState(() => new Map());
  const [context] = useState(() => ({ views, freshness }));
  const [config] = useState(() => ({
    provider: () => new Map(),
    dedupingInterval: 10_000,
    focusThrottleInterval: 30_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    errorRetryCount: 2,
    errorRetryInterval: 5_000,
    shouldRetryOnError: error => ![401, 403].includes(Number(error?.status)),
  }));
  return <SWRConfig value={config}><ViewCache.Provider value={context}>{children}</ViewCache.Provider></SWRConfig>;
}

// Explicit freshness avoids remount requests even during StrictMode's effect
// replay. SWR still owns concurrent requests, race protection and revalidation.
// oxlint-disable-next-line react/only-export-components
export function useWorkspaceQuery(key, fetcher, { staleTime = 15_000, ...options } = {}) {
  const { cache } = useSWRConfig();
  const context = useContext(ViewCache);
  const serialized = unstable_serialize(key);
  const updatedAt = context?.freshness.get(serialized);
  const fresh = cache.get(serialized)?.data !== undefined
    // oxlint-disable-next-line react/purity -- expiry is intentionally checked at route render.
    && updatedAt !== undefined && Date.now() - updatedAt < staleTime;
  return useSWR(key, async (...args) => {
    const data = await fetcher(...args);
    context?.freshness.set(serialized, Date.now());
    return data;
  }, { ...options, revalidateOnMount: !fresh });
}

// Mutations invalidate every matching filter/page, including unmounted queries.
// oxlint-disable-next-line react/only-export-components
export function useWorkspaceInvalidation() {
  const { cache, mutate } = useSWRConfig();
  const context = useContext(ViewCache);
  return useCallback((matches) => {
    for (const key of cache.keys()) {
      if (matches(cache.get(key)?._k)) context?.freshness.delete(key);
    }
    return mutate(matches);
  }, [cache, context, mutate]);
}

// Small UI preferences survive route unmounts, not logout or company switches.
// oxlint-disable-next-line react/only-export-components -- shared cache hook, not a component.
export function useWorkspaceView(key, initialValue) {
  const views = useContext(ViewCache)?.views;
  const [value, setValue] = useState(() => views?.has(key) ? views.get(key) : initialValue);
  useEffect(() => { views?.set(key, value); }, [views, key, value]);
  return [value, setValue];
}
