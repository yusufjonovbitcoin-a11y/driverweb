import { requireSupabase } from '../lib/supabase';
import { requireMfaAssurance } from './mfa';

export async function updateDriverPassword(driverId, password) {
  const client = requireSupabase();
  await requireMfaAssurance(client);
  const { data, error } = await client.functions.invoke('update-driver-password', { body: { driverId, password } });
  if (!error && data?.ok === true) return { retained: data.retained === true };
  let code = data?.error;
  if (!code && error?.context instanceof Response) {
    try { code = (await error.context.clone().json())?.error; } catch { /* Preserve a fixed safe failure code. */ }
  }
  const allowed = ['MFA_REQUIRED', 'FORBIDDEN', 'DRIVER_NOT_FOUND', 'INVALID_PASSWORD', 'PASSWORD_REJECTED', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'];
  throw new Error(allowed.includes(code) ? code : 'PASSWORD_UPDATE_FAILED');
}

export async function readDriverPassword(driverId, { reveal = false } = {}) {
  const client = requireSupabase();
  await requireMfaAssurance(client);
  const { data, error } = await client.functions.invoke('read-driver-password', { body: { driverId, action: reveal ? 'reveal' : 'status' } });
  if (!error && typeof data?.available === 'boolean' && (!reveal || !data.available || typeof data.password === 'string')) {
    return { available: data.available, ...(reveal && data.available ? { password: data.password } : {}) };
  }
  let code = data?.error;
  if (!code && error?.context instanceof Response) {
    try { code = (await error.context.clone().json())?.error; } catch { /* Return only fixed safe codes. */ }
  }
  const allowed = ['MFA_REQUIRED', 'FORBIDDEN', 'DRIVER_NOT_FOUND', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'];
  throw new Error(allowed.includes(code) ? code : 'PASSWORD_READ_FAILED');
}

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
