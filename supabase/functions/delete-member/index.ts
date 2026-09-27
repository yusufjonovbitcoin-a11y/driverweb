import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function rpcFailure(error: { message?: string } | null) {
  const message = error?.message || 'Company member could not be removed';
  if (message.includes('Driver has an active load')) {
    return json({ error: message, code: 'MEMBER_HAS_ACTIVE_LOAD' }, 409);
  }
  if (message.includes('Company member not found')) {
    return json({ error: message, code: 'MEMBER_NOT_FOUND' }, 404);
  }
  if (message.includes('permission') || message.includes('Only drivers or dispatchers')) {
    return json({ error: message, code: 'MEMBER_DELETE_FORBIDDEN' }, 403);
  }
  return json({ error: message, code: 'MEMBER_DELETE_FAILED' }, 400);
}

Deno.serve((request) => withCors(request, async () => {
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

  const caller = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

  const { data: requester, error: requesterError } = await caller
    .from('profiles')
    .select('id,company_id,role,status')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (requesterError || !requester || requester.status !== 'active') {
    return json({ error: 'Active requester profile not found' }, 403);
  }
  if (requester.role !== 'company_admin' || !requester.company_id) {
    return json({ error: 'Company admin permission required', code: 'MEMBER_DELETE_FORBIDDEN' }, 403);
  }

  const payload = await request.json().catch(() => ({}));
  const memberId = String(payload?.memberId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) {
    return json({ error: 'Valid member ID is required', code: 'MEMBER_ID_INVALID' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: suspendError } = await admin.rpc(
    'suspend_company_member_for_deletion',
    { requested_by: requester.id, target_member_id: memberId },
  );
  if (suspendError || !profile) return rpcFailure(suspendError);

  const { error: deleteError } = await admin.auth.admin.deleteUser(memberId, true);
  if (deleteError) {
    return json({
      error: 'Member access was suspended, but Auth cleanup must be retried',
      code: 'MEMBER_AUTH_DELETE_FAILED',
    }, 500);
  }

  const { error: auditError } = await admin.from('audit_events').insert({
    company_id: profile.company_id,
    actor_id: requester.id,
    action: 'member.auth_deleted',
    entity_type: 'profile',
    entity_id: profile.id,
    new_value: { status: profile.status, role: profile.role },
    metadata: { source: 'delete-member', auth_deletion: 'soft' },
  });

  if (auditError) {
    console.error('Member Auth deletion audit failed', {
      memberId,
      requesterId: requester.id,
      message: auditError.message,
    });
    return json({
      profile,
      warning: 'MEMBER_AUTH_AUDIT_FAILED',
    });
  }

  return json({ profile });
}));
