import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.1';
import { requireUserMfa } from './mfa.ts';
import { SAMSARA_API, SamsaraError, exchangeToken, readPages, normalizeFleet, seal, unseal, errorCode, type Credentials } from './samsara-core.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
export function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new SamsaraError('NOT_CONFIGURED');
  return value;
}
export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth:{persistSession:false,autoRefreshToken:false} });
}
export type Admin = ReturnType<typeof adminClient>;
export async function serverConfig(admin: Admin) {
  const config = check(await admin.rpc('get_samsara_server_config')) || {};
  return (name: string) => {
    const value = config[name];
    if (typeof value !== 'string' || !value) throw new SamsaraError('NOT_CONFIGURED');
    return value;
  };
}
export const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function check<T>(result: {data:T;error:unknown}): T {
  if (result.error) throw new SamsaraError('DATABASE_ERROR');
  return result.data;
}
export async function requireAdmin(request: Request, admin: Admin) {
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw json({error:'AUTH_REQUIRED'},401);
  const {data,error} = await admin.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
  if (error || !data.user) throw json({error:'AUTH_REQUIRED'},401);
  await requireUserMfa(authorization);
  const profile = check(await admin.from('profiles').select('id,company_id,role,status').eq('id',data.user.id).maybeSingle());
  if (!profile || profile.status !== 'active' || profile.role !== 'company_admin' || !profile.company_id) throw json({error:'ADMIN_REQUIRED'},403);
  return profile;
}
export async function connectionStatus(admin: Admin, company: string) {
  const row = check(await admin.from('samsara_connections').select('status,last_synced_at,last_error,snapshot,lease_until,updated_at').eq('company_id',company).maybeSingle());
  let configured = false;
  try { const config = await serverConfig(admin); configured = Boolean(config('SAMSARA_CLIENT_ID') && config('SAMSARA_CLIENT_SECRET') && config('SAMSARA_ENCRYPTION_KEY')); } catch { /* show configuration state, never credentials */ }
  return { configured,
    connection:row ? {status:row.status,lastSyncedAt:row.last_synced_at,lastError:row.last_error,updatedAt:row.updated_at,
      syncing:row.lease_until ? Date.parse(row.lease_until)>Date.now() : false, ...row.snapshot} : null };
}
export async function revoke(admin: Admin, credentials: Credentials) {
  const config = await serverConfig(admin);
  const response = await fetch(`${SAMSARA_API}/oauth2/revoke`, {method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{Authorization:`Basic ${btoa(`${config('SAMSARA_CLIENT_ID')}:${config('SAMSARA_CLIENT_SECRET')}`)}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({token:credentials.refresh_token})});
  return response.ok;
}
export async function syncCompany(admin: Admin, company: string, force=false) {
  const lease = crypto.randomUUID();
  const rows = check(await admin.rpc('claim_samsara_connection',{p_company:company,p_lease:lease}));
  const row = rows?.[0];
  if (!row) return;
  const save = async (patch: Record<string,unknown>) => check(await admin.from('samsara_connections').update(patch).eq('company_id',company).eq('generation',row.generation).eq('lease_id',lease).select('company_id'));
  try {
    // Manual requests cannot continuously poll the provider or bypass reconnect.
    if (row.status !== 'active' || (!force && Date.parse(row.next_sync_at)>Date.now()) || (force && row.last_synced_at && Date.parse(row.last_synced_at)>Date.now()-30000)) return;
    const config = await serverConfig(admin);
    let credentials: Credentials = await unseal(row.credentials,company,config('SAMSARA_ENCRYPTION_KEY'));
    if (!row.expires_at || Date.parse(row.expires_at)<Date.now()+60000) {
      // Refresh token rotates; do not retry the old token after an ambiguous failure.
      try {
        credentials = await exchangeToken(config('SAMSARA_CLIENT_ID'),config('SAMSARA_CLIENT_SECRET'),{grant_type:'refresh_token',refresh_token:credentials.refresh_token});
      } catch (error) {
        if (errorCode(error) !== 'RATE_LIMITED') await save({status:'needs_reconnect'});
        throw error;
      }
      const saved = await save({credentials:await seal(credentials,company,config('SAMSARA_ENCRYPTION_KEY')),expires_at:new Date(Date.now()+credentials.expires_in*1000).toISOString()});
      if (!saved?.length) return;
    }
    const paths = ['/fleet/drivers?driverActivationStatus=active','/fleet/vehicles','/fleet/vehicles/stats?types=gps','/fleet/hos/clocks'];
    const names = ['drivers','vehicles','gps','hos'];
    const results = await Promise.allSettled(paths.map(path=>readPages(path,credentials.access_token)));
    const errors: Record<string,string> = {};
    const data = results.map((result,i) => {
      if (result.status === 'fulfilled') return result.value;
      errors[names[i]] = errorCode(result.reason);
      return [];
    });
    const normalized = normalizeFleet(data[0],data[1],data[2],data[3]);
    // Publish one coherent sample. Failed feeds are explicit, not mislabeled old GPS.
    const needsReconnect = Object.values(errors).includes('RECONNECT_REQUIRED');
    await save({snapshot:{...normalized,capabilities:Object.fromEntries(names.map(name=>[name,errors[name]||'ok']))},
      last_synced_at:new Date().toISOString(),last_error:Object.keys(errors).length?'PARTIAL_SYNC':null,
      status:needsReconnect?'needs_reconnect':'active',next_sync_at:new Date(Date.now()+120000).toISOString(),updated_at:new Date().toISOString()});
  } catch (error) {
    await save({last_error:errorCode(error),next_sync_at:new Date(Date.now()+120000).toISOString()});
  } finally {
    await save({lease_id:null,lease_until:null});
  }
}
export function background(promise: Promise<unknown>) {
  const safe = promise.catch(() => console.error('Samsara background task failed'));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(safe);
  return safe;
}
