import { requireSupabase } from '../lib/supabase';
import { fetchDriverTrackRows } from './trackingQueries.js';

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

/** Reconcile the complete paged track, including late offline batches. */
export async function fetchDriverTrack(driverId, loadId) {
  if (!driverId || !loadId) return [];
  return fetchDriverTrackRows(requireSupabase(), driverId, loadId);
}
