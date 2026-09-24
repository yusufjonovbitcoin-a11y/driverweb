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
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization) return json({ error: 'Authentication required' }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey) {
    return json({ error: 'Function environment is incomplete' }, 500);
  }

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);
  const { data: requester } = await callerClient
    .from('profiles')
    .select('id, role, status')
    .eq('id', authData.user.id)
    .single();
  if (!requester || requester.role !== 'super_admin' || requester.status !== 'active') {
    return json({ error: 'Super admin permission required' }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const companyName = String(payload.companyName ?? '').trim();
  const adminEmail = String(payload.adminEmail ?? '').trim().toLowerCase();
  const adminFullName = String(payload.adminFullName ?? '').trim();
  const adminPhone = String(payload.adminPhone ?? '').trim() || null;
  if (!companyName || !adminFullName || !adminEmail.includes('@')) {
    return json({ error: 'Company name, admin name, and admin email are required' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    adminEmail,
    {
      data: { full_name: adminFullName, role: 'company_admin' },
      redirectTo: Deno.env.get('INVITE_REDIRECT_URL') || undefined,
    },
  );
  if (inviteError || !invite.user) {
    return json({ error: inviteError?.message || 'Could not invite company admin' }, 400);
  }

  const { data: companyId, error: companyError } = await adminClient.rpc(
    'create_company_with_admin',
    {
      requested_by: requester.id,
      company_name: companyName,
      admin_user_id: invite.user.id,
      admin_full_name: adminFullName,
      admin_email: adminEmail,
      admin_phone: adminPhone,
    },
  );
  if (companyError) {
    await adminClient.auth.admin.deleteUser(invite.user.id);
    return json({ error: companyError.message }, 400);
  }
  return json({ companyId }, 201);
});
