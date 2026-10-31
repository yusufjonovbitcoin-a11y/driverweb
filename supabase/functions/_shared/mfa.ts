import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Call with the user's JWT, even when the rest of the handler needs service access.
// The database checks verified factors; an AAL1 token cannot bypass an enrolled factor.
export async function requireUserMfa(authorization: string) {
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await caller.rpc('require_mfa_session');
  if (error) throw new Response(JSON.stringify({ error: 'MFA_REQUIRED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}
