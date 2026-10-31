import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.1';
import { withCors } from '../_shared/cors.ts';
import { requireUserMfa } from '../_shared/mfa.ts';
import { checkDistributedRateLimit } from '../_shared/rate-limit.ts';
import { handleReadDriverPassword } from './handler.ts';
import { passwordJson } from '../_shared/driver-password-access.ts';

Deno.serve(request => withCors(request, async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceKey) return passwordJson({ error: 'SERVICE_UNAVAILABLE' }, 503);
  return handleReadDriverPassword(request, {
    createCaller: authorization => createClient(url, publicKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } }),
    createAdmin: () => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    requireMfa: requireUserMfa,
    checkLimit: (admin, actor, reveal) => checkDistributedRateLimit(admin, reveal ? 'driver-password-reveal' : 'driver-password-status', actor, { limit: reveal ? 10 : 60, windowMs: reveal ? 5 * 60_000 : 60_000, supabaseUrl: url }),
  });
}));
