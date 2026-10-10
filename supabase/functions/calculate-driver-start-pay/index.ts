import { withCors } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkDistributedRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';
import { isDriverPayWorker, processDriverStartPay } from '../_shared/driver-start-pay.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(request => withCors(request, async () => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const env = (key: string) => Deno.env.get(key);
  const url = env('SUPABASE_URL'), publicKey = env('SUPABASE_ANON_KEY'), secret = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !secret) return json({ error: 'Service unavailable' }, 503);
  const worker = isDriverPayWorker(request, env('DRIVER_PAY_CRON_TOKEN'));
  let payload: any;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'Invalid payload' }, 400);
  const assignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId : null;
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  if (!worker) {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required' }, 401);
    if (!assignmentId || !uuid.test(assignmentId)) return json({ error: 'Assignment ID is required' }, 400);
    const caller = createClient(url, publicKey, { global: { headers: { Authorization: authorization } } });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return json({ error: 'Invalid session' }, 401);
    const { data: profile, error: profileError } = await caller.from('profiles')
      .select('id,role,status,company_id').eq('id', auth.user.id).maybeSingle();
    if (profileError || profile?.status !== 'active' || profile?.role !== 'driver') return json({ error: 'Driver permission required' }, 403);
    // Authenticate and restrict the exact assignment before any service-role
    // lease/route operation; payload coordinates, rates and money are ignored.
    const { data: assignment, error: assignmentError } = await caller.from('assignments')
      .select('id,driver_id,company_id,status').eq('id', assignmentId)
      .eq('driver_id', auth.user.id).eq('company_id', profile.company_id).maybeSingle();
    if (assignmentError || !assignment || !['active', 'completed'].includes(assignment.status)) return json({ error: 'Assignment unavailable' }, 403);
    const limit = await checkDistributedRateLimit(admin, 'calculate-driver-start-pay', auth.user.id,
      { limit: 30, windowMs: 5 * 60_000, supabaseUrl: url });
    if (!limit.allowed) return rateLimitResponse(limit);
  }
  try {
    // A short one-job batch bounds route API work and prevents overlapping
    // requests from settling twice; the durable DB lease governs every retry.
    const result = await processDriverStartPay(admin, crypto.randomUUID(), worker ? null : assignmentId, env);
    return json(result);
  } catch {
    return json({ error: 'Mileage calculation is pending; it will retry automatically.' }, 503);
  }
}));
