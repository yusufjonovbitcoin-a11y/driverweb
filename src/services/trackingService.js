import { requireSupabase } from '../lib/supabase';

const pageSize = 1000;

export async function fetchDriverTrackingSessions(driverId) {
  if (!driverId) return [];
  const client = requireSupabase();
  const sessions = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('driver_tracking_sessions')
      .select('assignment_id,load_id,started_at,ended_at')
      .eq('driver_id', driverId)
      .order('started_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    sessions.push(...(data || []));
    if (!data || data.length < pageSize) return sessions;
  }
}

/** Read a full track or only points added since a timestamp, in pages. */
export async function fetchDriverTrack(driverId, loadId, since = null) {
  if (!driverId || !loadId) return [];
  const client = requireSupabase();
  const points = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = client
      .from('driver_location_points')
      .select('id,assignment_id,latitude,longitude,accuracy_m,speed_mps,heading_deg,captured_at')
      .eq('driver_id', driverId)
      .eq('load_id', loadId)
      .order('captured_at', { ascending: true })
      .order('id', { ascending: true });
    if (since) query = query.gte('captured_at', since);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    points.push(...(data || []));
    if (!data || data.length < pageSize) return points;
  }
}
