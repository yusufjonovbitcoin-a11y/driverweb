import { withCors } from "../_shared/cors.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function publicConnection(connection: Record<string, unknown> | null) {
  if (!connection) return null;
  return {
    id: connection.id,
    mailboxEmail: connection.mailbox_email,
    status: connection.status,
    lastSyncedAt: connection.last_synced_at,
    lastError: connection.last_error,
    updatedAt: connection.updated_at,
  };
}

Deno.serve((request) => withCors(request, async () => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required' }, 401);

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,company_id,role,status')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError || !profile || profile.status !== 'active' || profile.role !== 'company_admin' || !profile.company_id) {
      return json({ error: 'Company admin permission required' }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // An empty body is equivalent to a status request.
    }
    const action = String(body.action || 'status');

    if (action === 'status') {
      const { data, error } = await admin
        .from('gmail_connections')
        .select('id,mailbox_email,status,last_synced_at,last_error,updated_at')
        .eq('company_id', profile.company_id)
        .maybeSingle();
      if (error) throw error;
      return json({ connection: publicConnection(data) });
    }

    if (action === 'connect') {
      const mailboxEmail = String(body.mailboxEmail || '').trim().toLowerCase();
      const appPassword = String(body.appPassword || '').replace(/\s+/g, '');
      if (!/^[^@\s]+@gmail\.com$/i.test(mailboxEmail)) {
        return json({ code: 'INVALID_GMAIL', error: 'Gmail manzilini to‘g‘ri kiriting.' }, 400);
      }
      if (!/^[A-Za-z0-9]{16}$/.test(appPassword)) {
        return json({ code: 'INVALID_APP_PASSWORD', error: 'App Password 16 ta belgidan iborat bo‘lishi kerak.' }, 400);
      }
      const { data, error } = await admin.rpc('configure_gmail_app_password', {
        requested_by: profile.id,
        mailbox_email: mailboxEmail,
        app_password: appPassword,
      });
      if (error) {
        console.error('Gmail credential save failed:', error.code || 'database_error');
        return json({ code: 'SAVE_FAILED', error: 'Gmail ma’lumotlarini saqlab bo‘lmadi.' }, 400);
      }
      return json({ connection: publicConnection(data) });
    }

    if (action === 'disconnect') {
      const { data, error } = await admin.rpc('disconnect_gmail_connection', {
        requested_by: profile.id,
      });
      if (error) {
        console.error('Gmail disconnect failed:', error.code || 'database_error');
        return json({ code: 'DISCONNECT_FAILED', error: 'Gmail ulanishini uzib bo‘lmadi.' }, 400);
      }
      return json({ connection: publicConnection(data) });
    }

    return json({ error: 'Unsupported action' }, 400);
  } catch (error) {
    console.error('Gmail integration failed:', error instanceof Error ? error.name : 'unknown_error');
    return json({ code: 'INTERNAL_ERROR', error: 'Gmail integratsiyasida server xatosi yuz berdi.' }, 500);
  }
}));
