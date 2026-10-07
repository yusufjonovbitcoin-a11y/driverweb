import { previewLoadRoute } from './google-load-route.ts';

// Shared by PDF confirmation, direct assignment and trash restore. A browser can
// request a quote but cannot provide its rate, origin, mileage or amount.
export async function prepareDriverPay(caller: any, admin: any, actorId: string,
  loadId: string, driverId: string, calculate = previewLoadRoute,
  env: (key: string) => string | undefined = key => Deno.env.get(key)) {
  const [{ data: load, error: loadError }, { data: driver, error: driverError }, settings] = await Promise.all([
    caller.from('loads').select('id,current_assignment_id').eq('id', loadId).maybeSingle(),
    caller.from('member_directory').select('id,status,role').eq('id', driverId).maybeSingle(),
    caller.from('driver_pay_settings').select('rate_per_mile').eq('driver_id', driverId).maybeSingle(),
  ]);
  if (loadError || driverError || !load || !driver || driver.status !== 'active' || driver.role !== 'driver') {
    throw new Error('Load or driver is unavailable');
  }
  if (settings.error) throw new Error('Driver pay settings unavailable');
  const access = await caller.rpc('can_access_driver', { target_driver_id: driverId });
  if (access.error || access.data !== true) throw new Error('Driver access denied');
  if (load.current_assignment_id) {
    const { data: existing, error } = await caller.from('assignments')
      .select('driver_id,status').eq('id',load.current_assignment_id).maybeSingle();
    if (error) throw new Error('Current assignment unavailable');
    // Retrying an already successful assignment must not reprice it or require
    // the driver to share their location again.
    if (existing?.driver_id === driverId && existing.status === 'active') {
      return { alreadyAssigned:true };
    }
  }
  if (settings.data?.rate_per_mile == null) return { fixedPay: false };
  const [{ data: stops, error: stopsError }, { data: presence, error: presenceError }] = await Promise.all([
    caller.from('load_stops').select('id,type,sequence,address_line,city,region,postal_code,latitude,longitude,contact_place_id')
      .eq('load_id',loadId).order('sequence').order('id'),
    admin.from('driver_presence').select('driver_id,latitude,longitude,is_online,last_seen_at,location_captured_at').eq('driver_id',driverId),
  ]);
  if (stopsError || presenceError) throw new Error('Route data unavailable');
  const snapshot = (stops ?? []).map((s: any) => [s.id,s.type,s.sequence,s.address_line,s.city,s.region,s.postal_code,s.latitude,s.longitude]);
  const route = await calculate(stops ?? [],presence ?? [],[driverId],
    env('GOOGLE_PLACES_API_KEY') ?? '',fetch,Date.now(),env('MAPBOX_ACCESS_TOKEN') ?? '', 'mapbox')
    .catch((error: unknown) => { throw new Error(`DRIVER_PAY_ROUTE_UNAVAILABLE: ${error instanceof Error ? error.message : 'Route unavailable'}`); });
  const target = route.targets.find((t: any) => t.driverId === driverId);
  if (!target || target.status !== 'ready' || target.deadheadMiles == null || !target.locationAt) {
    throw new Error('DRIVER_PAY_GPS_REQUIRED: Driver must share a fresh location before assignment. Mileage cannot be guessed.');
  }
  if (!Number.isFinite(route.loadedMiles) || route.loadedMiles <= 0 ||
      !Number.isFinite(target.deadheadMiles) || target.deadheadMiles < 0) {
    throw new Error('DRIVER_PAY_DISTANCE_INVALID');
  }
  const { error } = await admin.rpc('prepare_driver_pay_quote', {
    p_load_id:loadId,p_driver_id:driverId,p_requested_by:actorId,
    p_rate:settings.data.rate_per_mile,p_loaded_miles:route.loadedMiles,p_deadhead_miles:target.deadheadMiles,
    p_stops:snapshot,p_latitude:target.originLatitude,p_longitude:target.originLongitude,
    p_location_at:target.locationAt,p_provider:route.provider,
  });
  if (error) throw new Error(error.message);
  return { fixedPay:true,ratePerMile:settings.data.rate_per_mile,
    loadedMiles:route.loadedMiles,deadheadMiles:target.deadheadMiles };
}
