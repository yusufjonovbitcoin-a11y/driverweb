import { useEffect, useState } from 'react';
import { fetchFleetRoute } from '../services/fleetRoute';

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

export function useFleetRoute(stops, roadRoute, enabled, contextKey) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([stops, roadRoute, attempt, contextKey]);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const [routeStops, shouldRoute] = JSON.parse(key);
    fetchFleetRoute(routeStops, token, { roadRoute: shouldRoute, signal: controller.signal })
      .then(data => { if (active) setResult({ key, data }); })
      .catch(() => { if (active) setResult({ key, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [enabled, key]);
  return { route: enabled && result?.key === key ? result : null,
    loading: Boolean(enabled && result?.key !== key), retry: () => setAttempt(value => value + 1) };
}
