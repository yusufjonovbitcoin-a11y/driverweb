import { calculateStartDriverPayRoute, DriverPayRouteError } from './google-load-route.ts';

// Cron has a dedicated credential, never a browser key or service-role token.
export function isDriverPayWorker(request: Request, expected: string | undefined) {
  const supplied = request.headers.get('X-Worker-Token') ?? '';
  if (!expected || !/^[0-9a-f]{64}$/.test(expected) || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export async function processDriverStartPay(admin: any, workerId: string, assignmentId: string | null,
  env: (key: string) => string | undefined, calculate = calculateStartDriverPayRoute) {
  const { data: lease, error } = await admin.rpc('claim_driver_pay_calculation', {
    p_worker_id: workerId, p_assignment_id: assignmentId,
  });
  if (error) throw new Error('Driver pay queue unavailable');
  if (!lease) return { claimed: 0, completed: 0, failed: 0 };
  try {
    // The persisted START fix can now be old. It is deliberately not replaced
    // with live presence, and its timestamp is never rewritten to look fresh.
    const route = await calculate(lease.stops, lease.origin,
      env('GOOGLE_PLACES_API_KEY') ?? '', fetch, env('MAPBOX_ACCESS_TOKEN') ?? '');
    if (!Number.isFinite(route.loadedMiles) || route.loadedMiles <= 0 ||
        !Number.isFinite(route.deadheadMiles) || route.deadheadMiles < 0 ||
        !['mapbox', 'google_routes'].includes(route.provider)) throw new Error('Invalid route');
    const { data: saved, error: saveError } = await admin.rpc('finish_driver_pay_calculation', {
      p_job_id: lease.jobId, p_worker_id: workerId, p_loaded_miles: route.loadedMiles,
      p_deadhead_miles: route.deadheadMiles, p_provider: route.provider, p_failed: false, p_error_code: null,
    });
    if (saveError) throw new Error('Unable to save driver pay');
    return { claimed: 1, completed: saved === true ? 1 : 0, failed: 0 };
  } catch (error) {
    // Never log/store provider errors (which may contain access tokens/URLs).
    // Invalid saved input is terminal; transient provider failures keep their
    // bounded retry policy. Staff can retry exhausted provider jobs safely.
    const errorCode = error instanceof DriverPayRouteError ? error.code : 'DRIVER_PAY_PROVIDER_UNAVAILABLE';
    const { error: retryError } = await admin.rpc('finish_driver_pay_calculation', {
      p_job_id: lease.jobId, p_worker_id: workerId, p_loaded_miles: null,
      p_deadhead_miles: null, p_provider: null, p_failed: true, p_error_code: errorCode,
    });
    if (retryError) throw new Error('Unable to record route retry');
    return { claimed: 1, completed: 0, failed: 1 };
  }
}
