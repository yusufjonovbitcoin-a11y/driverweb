// Import-safe HTTP boundary. The paused path must never create a DB client,
// load mailbox credentials, import the IMAP adapter, or initiate provider work.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2048;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function sameSecret(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function serverApiKey(env) {
  // Modern keys are compared against the runtime's server-only key map,
  // never against decoded JWT claims or a key prefix alone.
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const key = keys && typeof keys === 'object' && !Array.isArray(keys)
      && Object.hasOwn(keys, 'default') && keys.default;
    return typeof key === 'string' && key.startsWith('sb_secret_') ? key : null;
  } catch { return null; }
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('body_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_request');
  return body;
}

export function createGmailSyncHandler({ env, createAdmin, loadRuntime, randomUUID = () => crypto.randomUUID(), logger = console }) {
  return async function handle(request) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!serviceRoleKey) return json({ error: 'worker_not_configured' }, 503);
    const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    // A signed user/anon JWT is not worker authorization. Require an exact
    // server secret; the gateway's JWT check is an additional, not sole, barrier.
    const apiKey = request.headers.get('apikey');
    if (!sameSecret(bearer, serviceRoleKey)
      && !sameSecret(apiKey, serviceRoleKey)
      && !sameSecret(apiKey, serverApiKey(env))) return json({ error: 'unauthorized' }, 401);

    let body;
    try { body = await readBody(request); } catch { return json({ error: 'invalid_request' }, 400); }
    const action = body.action ?? 'status';
    if (!['status', 'run'].includes(action) || typeof body.companyId !== 'string' || !UUID.test(body.companyId)
      || Object.keys(body).some(key => !['action', 'companyId'].includes(key))) {
      return json({ error: 'invalid_request' }, 400);
    }
    // Deployment intentionally leaves this unset. There is NO public enable
    // action, query-string bypass, dry-run with side effects, or auto-Cron.
    if (env('GMAIL_CLOUD_WORKER_ENABLED') !== 'true') {
      return json({ status: 'paused', reason: 'deployment_disabled', executed: false });
    }

    const supabaseUrl = env('SUPABASE_URL')?.trim();
    const workerToken = env('GMAIL_WORKER_TOKEN')?.trim();
    if (!supabaseUrl || !workerToken) return json({ error: 'worker_not_configured' }, 503);
    let admin;
    let claim;
    const leaseOwner = randomUUID();
    let response;
    try {
      admin = createAdmin(supabaseUrl, serviceRoleKey);
      if (action === 'status') {
        const { data, error } = await admin.from('gmail_cloud_worker_controls')
          .select('enabled').eq('company_id', body.companyId).maybeSingle();
        if (error) throw new Error('control_read_failed');
        return json({ status: data?.enabled === true ? 'enabled' : 'paused', executed: false });
      }
      const { data, error } = await admin.rpc('claim_gmail_cloud_worker', {
        p_company_id: body.companyId, p_owner: leaseOwner, p_lease_seconds: 120,
      });
      if (error) throw new Error('claim_failed');
      if (!data || !['claimed', 'paused', 'busy', 'unavailable'].includes(data.status)) throw new Error('invalid_claim');
      if (data.status !== 'claimed') return json({ status: data.status, executed: false });
      if (!UUID.test(data.connection_id || '') || !Number.isSafeInteger(data.configuration_version)
        || data.configuration_version < 1 || (data.company_id && data.company_id !== body.companyId)) {
        throw new Error('invalid_claim');
      }
      claim = data;
      const { runGmailSync, dependencies } = await loadRuntime();
      const result = await runGmailSync({
        admin, companyId: body.companyId, leaseOwner,
        connection: { ...claim, id: claim.connection_id },
        workerToken, supabaseUrl, serviceRoleKey, maxRunMs: 90_000,
      }, dependencies);
      response = json({ status: 'completed', ...result, executed: true });
    } catch {
      // Never log a provider payload, email, credential, URL or raw exception.
      logger.error('gmail_cloud_worker_failed');
      response = json({ error: 'worker_failed' }, 500);
    } finally {
      if (claim && admin) {
        try {
          const { data, error } = await admin.rpc('release_gmail_cloud_worker', {
            p_company_id: body.companyId, p_owner: leaseOwner,
            p_connection_id: claim.connection_id,
            p_configuration_version: claim.configuration_version,
          });
          if (error || data?.status !== 'released') throw new Error('release_failed');
        } catch {
          logger.error('gmail_cloud_worker_release_failed');
          response = json({ error: 'worker_cleanup_failed' }, 500);
        }
      }
    }
    return response;
  };
}
