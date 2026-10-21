import { requireSupabase } from '../lib/supabase';

export async function fetchDriverAccountStatus(driverId) {
  const { data, error } = await requireSupabase().from('profiles').select('status').eq('id', driverId).single();
  if (error) throw error;
  return data.status;
}

export async function setDriverAccountStatus(driverId, nextStatus) {
  if (!['active', 'suspended'].includes(nextStatus)) throw new Error('Invalid account status');
  const { data, error } = await requireSupabase().rpc('set_member_status', { member_id: driverId, next_status: nextStatus });
  if (error) throw error;
  return Array.isArray(data) ? data[0]?.status : data?.status;
}

export async function fetchDriverSettingsHistory(driverId) {
  const { data, error } = await requireSupabase().from('audit_events')
    .select('id,action,actor_id,occurred_at').eq('entity_id', driverId)
    .order('occurred_at', { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}
