import { sameSecret } from '../_shared/samsara-core.ts';
import { adminClient, serverConfig, json, check, syncCompany, background } from '../_shared/samsara-server.ts';
Deno.serve(async request => {
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const admin = adminClient();
    const supplied = request.headers.get('x-worker-token') || '';
    if (!supplied) return json({error:'AUTH_REQUIRED'},401);
    const config = await serverConfig(admin);
    if (!await sameSecret(supplied,config('SAMSARA_WORKER_TOKEN'))) return json({error:'AUTH_REQUIRED'},401);
    const rows = check(await admin.from('samsara_connections').select('company_id').eq('status','active').lte('next_sync_at',new Date().toISOString()).order('next_sync_at').limit(2));
    // Bound parallel work. Leases also protect against overlapping Cron invocations.
    background((async()=>{
      for (let i=0;i<(rows?.length||0);i+=2) await Promise.all(rows!.slice(i,i+2).map(row=>syncCompany(admin,row.company_id)));
    })());
    return json({queued:rows?.length||0},202);
  } catch { return json({error:'INTERNAL_ERROR'},500); }
});
