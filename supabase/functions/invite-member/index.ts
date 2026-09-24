import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publicKey || !serviceRoleKey) {
    return json({ error: 'Function environment is incomplete' }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

  const { data: requester, error: profileError } = await callerClient
    .from('profiles')
    .select('id, company_id, role, status')
    .eq('id', authData.user.id)
    .single();
  if (profileError || !requester || requester.status !== 'active') {
    return json({ error: 'Active requester profile not found' }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const email = String(payload.email ?? '').trim().toLowerCase();
  const fullName = String(payload.fullName ?? '').trim();
  const phone = String(payload.phone ?? '').trim() || null;
  const role = String(payload.role ?? 'driver');
  const companyId = String(payload.companyId ?? requester.company_id ?? '');

  if (!email.includes('@') || !fullName || !companyId) {
    return json({ error: 'Email, full name, and company are required' }, 400);
  }
  const allowed = requester.role === 'super_admin'
    ? ['company_admin', 'dispatcher', 'driver'].includes(role)
    : requester.role === 'company_admin'
      ? ['dispatcher', 'driver'].includes(role) && companyId === requester.company_id
      : requester.role === 'dispatcher'
        ? role === 'driver' && companyId === requester.company_id
        : false;
  if (!allowed) return json({ error: 'Member management permission required' }, 403);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      data: { full_name: fullName, role, company_id: companyId },
      redirectTo: Deno.env.get('INVITE_REDIRECT_URL') || undefined,
    },
  );
  if (inviteError || !invite.user) {
    return json({ error: inviteError?.message || 'Could not create invite' }, 400);
  }

  const { data: profile, error: registerError } = await adminClient.rpc(
    'register_company_member_as',
    {
      requested_by: requester.id,
      user_id: invite.user.id,
      company_id: companyId,
      role,
      full_name: fullName,
      email,
      phone,
    },
  );
  if (registerError) {
    await adminClient.auth.admin.deleteUser(invite.user.id);
    return json({ error: registerError.message }, 400);
  }

  return json({ profile }, 201);
});
