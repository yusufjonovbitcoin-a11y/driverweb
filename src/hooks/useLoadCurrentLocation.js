import { useEffect, useRef, useState } from 'react';
import { loadCurrentLocation, loadRouteOrigin, latestPickupRouteStops, pickupEstimateScope, selectPickupEstimate } from '../components/loadDetailsModel.js';
import { useFleetRoute } from './useFleetRoute';

export function useLoadCurrentLocation(load, driver, startState) {
  const [now, setNow] = useState(() => Date.now());
  const lastRequestAt = useRef(0);
  const [routeInput, setRouteInput] = useState(null);
  const [completed, setCompleted] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const location = loadCurrentLocation(load, driver, now);
  const { origin, source } = loadRouteOrigin(location, startState);
  const stops = latestPickupRouteStops(load, origin);
  const scope = JSON.stringify([pickupEstimateScope(load.id, driver?.id, stops,
    load.currentAssignmentId, source === 'start' ? origin : null), source]);
  const requestedKey = JSON.stringify([load.id, driver?.id, stops]);
  const latestObservedAt = useRef(null);
  useEffect(() => { latestObservedAt.current = origin?.observedAt ?? null; }, [origin?.observedAt]);
  useEffect(() => {
    if (!stops.length) return undefined;
    const timer = setTimeout(() => {
      lastRequestAt.current = Date.now();
      setRouteInput({ scope, key: requestedKey, stops: JSON.parse(requestedKey)[2], observedAt: latestObservedAt.current });
    }, source === 'start' ? 0 : Math.max(0, 30_000 - (Date.now() - lastRequestAt.current)));
    return () => clearTimeout(timer);
  }, [requestedKey, stops.length, scope, source]);
  const matchingScope = routeInput?.scope === scope;
  const result = useFleetRoute(routeInput?.stops || [], true, Boolean(origin && matchingScope), scope);
  if (result.route && matchingScope && completed?.route !== result.route) {
    setCompleted({ scope, route: result.route, observedAt: routeInput.observedAt });
  }
  // Retain only estimates for this driver and this exact pickup. A GPS-only
  // refresh keeps its previous estimate visible with the captured fix timestamp.
  const estimate = selectPickupEstimate(scope,
    matchingScope ? { scope, route: result.route, observedAt: routeInput?.observedAt } : null,
    completed, Boolean(origin));
  const pickupRoute = { ...result, route: estimate?.route ?? null,
    observedAt: estimate?.observedAt ?? null,
    stale: source !== 'start' && Boolean(location?.stale || (estimate?.observedAt && now - estimate.observedAt > 120_000)),
    loading: Boolean(origin && !estimate && (!matchingScope || result.loading)) };
  return { location, pickupRoute, routeOrigin: origin, originSource: source };
}
