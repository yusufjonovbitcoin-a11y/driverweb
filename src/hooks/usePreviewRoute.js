import { useEffect, useRef, useState } from 'react';
import { fetchImportPreviewRoute } from '../services/importRoute';

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

export function usePreviewRoute(addresses, driverId, livePosition, enabled, observedAt = null) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [input, setInput] = useState(null);
  const lastRequestAt = useRef(0);
  const lastScope = useRef(null);
  const observedAtRef = useRef(observedAt);
  useEffect(() => { observedAtRef.current = observedAt; }, [observedAt]);
  const scope = JSON.stringify([addresses, driverId, attempt, Boolean(livePosition)]);
  const key = JSON.stringify([addresses, driverId, livePosition?.lat, livePosition?.lng, attempt]);
  useEffect(() => {
    if (!enabled) return undefined;
    const delay = lastScope.current === scope ? Math.max(0, 30_000 - (Date.now() - lastRequestAt.current)) : 0;
    const timer = setTimeout(() => {
      lastScope.current = scope;
      lastRequestAt.current = Date.now();
      setInput({ key, scope, observedAt: observedAtRef.current });
    }, delay);
    return () => clearTimeout(timer);
  }, [enabled, key, scope]);
  const matching = input?.scope === scope;
  useEffect(() => {
    if (!enabled || !matching) return undefined;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const [routeAddresses, id, lat, lng] = JSON.parse(input.key);
    const driver = id ? { id, position: lat == null || lng == null ? null : { lat, lng } } : null;
    fetchImportPreviewRoute(routeAddresses, token, driver, controller.signal)
      .then(data => { if (active) setResult({ scope: input.scope, data, observedAt: input.observedAt }); })
      .catch(() => { if (active) setResult({ scope: input.scope, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [enabled, input, matching]);
  // Estimates retain their own GPS timestamp while a newer fix is being routed.
  return { route: enabled && result?.scope === scope ? result : null,
    retry: () => { lastRequestAt.current = 0; setAttempt(value => value + 1); } };
}
