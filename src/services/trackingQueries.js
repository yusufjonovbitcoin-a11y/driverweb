const PAGE_SIZE = 1000;

// Captured time is supplied by an offline device and can move backwards between
// uploads. Refresh a complete deterministic snapshot instead of filtering on it.
export async function fetchDriverTrackRows(client, driverId, loadId) {
  if (!driverId || !loadId) return [];
  const points = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from('driver_location_points')
      .select('id,assignment_id,latitude,longitude,accuracy_m,speed_mps,heading_deg,captured_at')
      .eq('driver_id', driverId).eq('load_id', loadId)
      .order('captured_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    points.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return points;
  }
}
