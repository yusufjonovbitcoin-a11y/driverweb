import { useEffect, useState } from 'react';
import { fetchImportPreviewRoute } from '../services/importRoute';

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

export function usePreviewRoute(addresses, driverId, livePosition, enabled) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([addresses, driverId, livePosition?.lat, livePosition?.lng, attempt]);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const [routeAddresses, id, lat, lng] = JSON.parse(key);
    const driver = id ? { id, position: lat == null || lng == null ? null : { lat, lng } } : null;
    fetchImportPreviewRoute(routeAddresses, token, driver, controller.signal)
      .then(data => { if (active) setResult({ key, data }); })
      .catch(() => { if (active) setResult({ key, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [enabled, key]);
  return { route: enabled && result?.key === key ? result : null,
    retry: () => setAttempt(value => value + 1) };
}
