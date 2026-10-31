import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.1';
import { withCors } from '../_shared/cors.ts';
import { requireUserMfa } from '../_shared/mfa.ts';
import { checkDistributedRateLimit } from '../_shared/rate-limit.ts';
import { handleDriverPassword } from './handler.ts';

Deno.serve(request => withCors(request, async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceKey) return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), {
    status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  return handleDriverPassword(request, {
    createCaller: authorization => createClient(url, publicKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } }),
    createAdmin: () => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    requireMfa: requireUserMfa,
    checkLimit: (admin, actor) => checkDistributedRateLimit(admin, 'driver-password-reset', actor, { limit: 10, windowMs: 5 * 60_000, supabaseUrl: url }),
  });
}));
