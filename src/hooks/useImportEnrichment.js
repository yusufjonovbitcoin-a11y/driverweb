import { useEffect, useState } from 'react';
import { fetchImportRoadRoute } from '../services/operationsService';

export function useImportEnrichment(loadId, driverId, enabled) {
  const [route, setRoute] = useState(null);
  const [retry, setRetry] = useState(0);
  const key = `${loadId}:${driverId}:${retry}`;
  useEffect(() => {
    if (!loadId || !enabled) return;
    let active = true;
    const controller = new AbortController();
    fetchImportRoadRoute(loadId, driverId, controller.signal)
      .then(data => { if (active) setRoute({ key, data }); })
      .catch(() => { if (active) setRoute({ key, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [loadId, driverId, enabled, key]);
  // A changed driver can never display the previous driver's distance.
  return { route: enabled && route?.key === key ? route : null,
    retry: () => setRetry(value => value + 1) };
}
