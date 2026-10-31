import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.1';
import { withCors } from '../_shared/cors.ts';
import { signedAuthenticatedDeliveryUrl, temporaryAuthenticatedDownloadUrl } from '../_shared/cloudinary-delivery.ts';
import { checkDistributedRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts';
import { documentContentResponse } from '../_shared/document-content.ts';

const json = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const env = (key: string) => { const value = Deno.env.get(key); if (!value) throw new Error('Server configuration missing'); return value; };

Deno.serve(request => withCors(request, async () => {
  if (!['GET', 'POST'].includes(request.method)) return json('Method not allowed', 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json('Authentication required', 401);
  try {
    const url = env('SUPABASE_URL');
    const caller = createClient(url, env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(authorization.slice(7));
    if (authError || !auth.user) return json('Invalid session', 401);
    const { data: profile, error: profileError } = await caller.from('profiles').select('id,status').eq('id', auth.user.id).maybeSingle();
    if (profileError || profile?.status !== 'active') return json('Active profile required', 403);
    // The admin client is restricted to rate limiting, not document/media reads.
    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const limit = await checkDistributedRateLimit(admin, 'document-content', auth.user.id, { limit: 90, windowMs: 60_000, supabaseUrl: url });
    if (!limit.allowed) return rateLimitResponse(limit);
    const versionId = request.method === 'GET' ? new URL(request.url).searchParams.get('versionId') : (await request.json().catch(() => ({}))).versionId;
    return await documentContentResponse(versionId, {
      async readVersion(id) {
        const { data, error } = await caller.from('document_versions').select('storage_path,mime_type,size_bytes').eq('id', id).single();
        if (error) return null; return data;
      },
      async readAsset(id) {
        const { data, error } = await caller.from('media_assets').select('scope,mime_type,public_id,resource_type,delivery_type,version,format,deleted_at').eq('id', id).is('deleted_at', null).single();
        if (error) return null; return data;
      },
      deliveryUrl: asset => signedAuthenticatedDeliveryUrl({
        cloudName: env('CLOUDINARY_CLOUD_NAME'), apiSecret: env('CLOUDINARY_API_SECRET'),
        publicId: String(asset.public_id), resourceType: String(asset.resource_type), version: Number(asset.version),
        format: asset.resource_type === 'raw' ? null : asset.format ? String(asset.format) : null,
      }),
      previewUrl: asset => signedAuthenticatedDeliveryUrl({
        cloudName: env('CLOUDINARY_CLOUD_NAME'), apiSecret: env('CLOUDINARY_API_SECRET'),
        publicId: String(asset.public_id), resourceType: 'image', version: Number(asset.version),
        format: asset.format ? String(asset.format) : 'pdf', transformation: 'pg_1,w_1400,q_65,f_jpg',
      }),
      previewFallbackUrl: asset => temporaryAuthenticatedDownloadUrl({
        cloudName: env('CLOUDINARY_CLOUD_NAME'), apiKey: env('CLOUDINARY_API_KEY'), apiSecret: env('CLOUDINARY_API_SECRET'),
        publicId: String(asset.public_id), resourceType: 'image', format: asset.format ? String(asset.format) : 'pdf',
        expiresAt: Math.floor(Date.now() / 1000) + 120, transformation: 'pg_1,w_1400,q_65,f_jpg',
      }),
    }, request.signal, request.headers.get('Range'), new URL(request.url).searchParams.get('preview') === '1');
  } catch { return json('Document delivery unavailable', 502); }
}, { allowedMethods: 'GET, POST, OPTIONS', allowedHeaders: 'authorization,apikey,content-type,range,x-client-info' }));
