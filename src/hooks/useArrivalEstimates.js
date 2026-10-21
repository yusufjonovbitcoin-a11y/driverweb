import { useEffect, useRef, useState } from 'react';
import { fetchFleetRoute } from '../services/fleetRoute.js';

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

export function useArrivalEstimates(jobs, now) {
  const latest = useRef(jobs);
  const [results, setResults] = useState({});
  useEffect(() => { latest.current = jobs; }, [jobs]);
  const scope = JSON.stringify(jobs.filter(job => job.load).map(job => [job.id, job.scope]));
  const minute = Math.floor(now / 60_000);
  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    const pending = latest.current.filter(job => job.target && job.location && !job.location.stale);
    async function worker() {
      while (pending.length && !controller.signal.aborted) {
        const job = pending.shift();
        try {
          const route = await fetchFleetRoute([
            { sequence: 1, latitude: job.location.lat, longitude: job.location.lng },
            { ...job.target, sequence: 2 },
          ], token, { signal: controller.signal });
          if (!controller.signal.aborted && !route.routingFailed && Number.isFinite(route.durationSeconds)) {
            const estimate = { scope: job.scope, observedAt: job.location.observedAt,
              eta: job.location.observedAt + route.durationSeconds * 1000 };
            setResults(previous => ({ ...previous, [job.id]: estimate }));
          }
        } catch { /* Missing estimates are surfaced explicitly in the card. */ }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker)).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [scope, minute]);
  return results;
}
