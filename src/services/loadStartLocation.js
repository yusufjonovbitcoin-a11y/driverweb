// START is an accepted command's immutable GPS snapshot, never driver_presence
// or the first point of a tracking session (tracking can begin before START).
export async function fetchLoadStartLocation(client, { loadId, assignmentId, driverId }, signal) {
  if (!loadId || !assignmentId || !driverId) return { status: 'awaiting_start', location: null };
  const operationResult = await client.from('client_operations')
    .select('operation_id,load_id,actor_id,occurred_at,received_at,result')
    .eq('load_id', loadId).eq('actor_id', driverId)
    .eq('command_type', 'advance_driver_stage').eq('status', 'accepted')
    .eq('payload->>nextStage', 'en_route_to_pickup').eq('result->>assignmentId', assignmentId)
    .order('received_at', { ascending: true }).limit(1).maybeSingle().abortSignal(signal);
  if (operationResult.error) throw operationResult.error;
  const operation = operationResult.data;
  if (!operation) return { status: 'awaiting_start', location: null };
  if (operation.load_id !== loadId || operation.actor_id !== driverId
    || operation.result?.assignmentId !== assignmentId || operation.result?.loadId !== loadId
    || !Number.isFinite(Date.parse(operation.occurred_at)) || !Number.isFinite(Date.parse(operation.received_at))) {
    throw new Error('LOAD_START_SCOPE_MISMATCH');
  }
  // Both rows are written in the same transaction with now(). Matching receipt
  // time as well as capture time excludes an older assignment's offline START.
  const snapshotResult = await client.from('location_snapshots')
    .select('latitude,longitude,captured_at')
    .eq('load_id', loadId).eq('driver_id', driverId).eq('event_type', 'driver.en_route_to_pickup')
    .eq('captured_at', operation.occurred_at).eq('created_at', operation.received_at)
    .limit(2).abortSignal(signal);
  if (snapshotResult.error) throw snapshotResult.error;
  const rows = snapshotResult.data || [];
  const snapshot = rows.length === 1 ? rows[0] : null;
  const valid = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value));
  if (!snapshot || !valid(snapshot.latitude) || !valid(snapshot.longitude)
    || Math.abs(Number(snapshot.latitude)) > 90 || Math.abs(Number(snapshot.longitude)) > 180
    || Date.parse(snapshot.captured_at) !== Date.parse(operation.occurred_at)) {
    return { status: 'missing_location', location: null };
  }
  return { status: 'ready', location: { lat: Number(snapshot.latitude), lng: Number(snapshot.longitude),
    observedAt: Date.parse(snapshot.captured_at), capturedAt: snapshot.captured_at } };
}
