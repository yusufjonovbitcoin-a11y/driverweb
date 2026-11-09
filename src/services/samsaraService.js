import { requireSupabase } from '../lib/supabase';
import { invokeAuthenticatedFunction } from './authenticatedFunction.js';

export async function samsaraRequest(action) {
  const { data, error } = await invokeAuthenticatedFunction(requireSupabase(), 'samsara-integration', { action });
  if (error) {
    let code = 'REQUEST_FAILED';
    try { code = (await error.context?.json())?.error || code; } catch { /* no provider details in UI */ }
    throw new Error(code);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function samsaraCameraRequest(action, payload = {}) {
  const { data, error } = await invokeAuthenticatedFunction(requireSupabase(), 'samsara-cameras', { ...payload, action });
  if (error) {
    let code = 'REQUEST_FAILED';
    try { code = (await error.context?.json())?.error || code; } catch { /* No provider details. */ }
    throw new Error(code);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function validSamsaraAuthorizationUrl(input) {
  try {
    const url = new URL(input);
    return url.origin === 'https://api.samsara.com' && url.pathname === '/oauth2/authorize' && !url.username && !url.password;
  } catch { return false; }
}

export function hosDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
