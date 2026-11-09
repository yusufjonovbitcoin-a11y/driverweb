import { stateHash, exchangeToken, seal, returnLocation } from '../_shared/samsara-core.ts';
import { adminClient, serverConfig, check, syncCompany, background, revoke } from '../_shared/samsara-server.ts';

const redirect = (origin: string, result: string) => new Response(null,{status:303,headers:{Location:returnLocation(origin,result),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
Deno.serve(async request => {
  if (request.method !== 'GET') return new Response('Method not allowed',{status:405});
  let origin = 'https://managefleets.com';
  try {
    const url = new URL(request.url), state = url.searchParams.get('state')||'';
    if (!/^[a-f0-9]{64}$/.test(state)) return redirect(origin,'invalid_state');
    const admin = adminClient();
    // DELETE RETURNING consumes the state atomically, including denial responses.
    const states = check(await admin.from('samsara_oauth_states').delete().eq('state_hash',await stateHash(state)).gt('expires_at',new Date().toISOString()).select('*'));
    const pending = states?.[0];
    if (!pending) return redirect(origin,'invalid_state');
    origin = pending.return_origin;
    const profile = check(await admin.from('profiles').select('company_id,role,status').eq('id',pending.actor_id).maybeSingle());
    if (!profile || profile.company_id !== pending.company_id || profile.role !== 'company_admin' || profile.status !== 'active') return redirect(origin,'invalid_state');
    const current = check(await admin.from('samsara_connections').select('oauth_attempt').eq('company_id',pending.company_id).maybeSingle());
    if (current?.oauth_attempt !== pending.attempt_id) return redirect(origin,'invalid_state');
    if (url.searchParams.has('error')) return redirect(origin,'denied');
    const code = url.searchParams.get('code');
    if (!code || code.length>4096) return redirect(origin,'failed');
    const config = await serverConfig(admin);
    const credentials = await exchangeToken(config('SAMSARA_CLIENT_ID'),config('SAMSARA_CLIENT_SECRET'),{grant_type:'authorization_code',code});
    const saved = check(await admin.from('samsara_connections').update({status:'active',connected_by:pending.actor_id,
      credentials:await seal(credentials,pending.company_id,config('SAMSARA_ENCRYPTION_KEY')),expires_at:new Date(Date.now()+credentials.expires_in*1000).toISOString(),
      generation:crypto.randomUUID(),oauth_attempt:null,lease_id:null,lease_until:null,snapshot:{},last_synced_at:null,last_error:null,
      next_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('company_id',pending.company_id).eq('oauth_attempt',pending.attempt_id).select('company_id'));
    if (!saved?.length) { await revoke(admin,credentials); return redirect(origin,'invalid_state'); }
    background(syncCompany(admin,pending.company_id));
    return redirect(origin,'connected');
  } catch {
    // Do not log callback URLs, codes, provider bodies or tokens.
    return redirect(origin,'failed');
  }
});
