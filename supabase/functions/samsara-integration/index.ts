import { withCors } from '../_shared/cors.ts';
import { authorizationUrl, returnOrigin, randomState, stateHash, unseal, errorCode } from '../_shared/samsara-core.ts';
import { adminClient, env, serverConfig, json, check, requireAdmin, connectionStatus, syncCompany, background, revoke } from '../_shared/samsara-server.ts';

Deno.serve(request => withCors(request, async () => {
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const admin = adminClient();
    const profile = await requireAdmin(request,admin);
    let body;
    try { body = await request.json(); } catch { return json({error:'INVALID_REQUEST'},400); }
    if (!body || typeof body !== 'object') return json({error:'INVALID_REQUEST'},400);
    if (body.action === 'status') return json(await connectionStatus(admin,profile.company_id));
    if (body.action === 'connect') {
      const config = await serverConfig(admin);
      config('SAMSARA_CLIENT_SECRET'); config('SAMSARA_ENCRYPTION_KEY');
      const state = randomState(), attempt = crypto.randomUUID();
      // Insert-if-absent preserves an existing active connection during re-consent.
      check(await admin.from('samsara_connections').upsert({company_id:profile.company_id},{onConflict:'company_id',ignoreDuplicates:true}));
      check(await admin.from('samsara_connections').update({oauth_attempt:attempt}).eq('company_id',profile.company_id));
      check(await admin.from('samsara_oauth_states').delete().eq('company_id',profile.company_id));
      check(await admin.from('samsara_oauth_states').insert({state_hash:await stateHash(state),attempt_id:attempt,company_id:profile.company_id,actor_id:profile.id,
        return_origin:returnOrigin(request.headers.get('origin')),expires_at:new Date(Date.now()+600000).toISOString()}));
      const callback = `${env('SUPABASE_URL')}/functions/v1/samsara-oauth-callback`;
      return json({url:authorizationUrl(config('SAMSARA_CLIENT_ID'),state,callback)});
    }
    if (body.action === 'sync') {
      background(syncCompany(admin,profile.company_id,true));
      return json({queued:true},202);
    }
    if (body.action === 'disconnect') {
      const lease = crypto.randomUUID();
      const rows = check(await admin.rpc('claim_samsara_connection',{p_company:profile.company_id,p_lease:lease}));
      const row = rows?.[0];
      if (!row) {
        const existing = check(await admin.from('samsara_connections').select('credentials').eq('company_id',profile.company_id).maybeSingle());
        if (existing?.credentials) return json({error:'SYNC_BUSY'},409);
      }
      let revoked = true;
      if (row) {
        try { const config = await serverConfig(admin); revoked = await revoke(admin,await unseal(row.credentials,profile.company_id,config('SAMSARA_ENCRYPTION_KEY'))); }
        catch { revoked = false; }
      }
      check(await admin.from('samsara_connections').update({status:'disconnected',credentials:null,expires_at:null,snapshot:{},oauth_attempt:null,
        generation:crypto.randomUUID(),lease_id:null,lease_until:null,last_synced_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('company_id',profile.company_id));
      check(await admin.from('samsara_oauth_states').delete().eq('company_id',profile.company_id));
      return json({...(await connectionStatus(admin,profile.company_id)),warning:revoked?null:'REVOKE_IN_SAMSARA'});
    }
    return json({error:'INVALID_ACTION'},400);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({error:errorCode(error)},500);
  }
}));
