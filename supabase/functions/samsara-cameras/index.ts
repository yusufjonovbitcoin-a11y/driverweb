import { withCors } from '../_shared/cors.ts';
import { errorCode } from '../_shared/samsara-core.ts';
import { adminClient, requireAdmin, json } from '../_shared/samsara-server.ts';
import { cameraAction } from '../_shared/samsara-camera-server.ts';

Deno.serve(request => withCors(request,async()=>{
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const admin = adminClient(), profile = await requireAdmin(request,admin);
    if (Number(request.headers.get('Content-Length') || 0) > 10000) return json({error:'INVALID_REQUEST'},400);
    const text = await request.text();
    if (text.length > 10000) return json({error:'INVALID_REQUEST'},400);
    let body;
    try { body = JSON.parse(text); } catch { return json({error:'INVALID_REQUEST'},400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'INVALID_REQUEST'},400);
    return json(await cameraAction(admin,profile.company_id,profile.id,body));
  } catch (error) {
    if (error instanceof Response) return error;
    const code = errorCode(error);
    return json({error:code},code === 'SYNC_BUSY' ? 409 : code === 'RATE_LIMITED' ? 429 : code.includes('REQUIRED') ? 403 : ['INVALID_ACTION','INVALID_REQUEST','INVALID_TIME_RANGE','CAMERA_REQUEST_REJECTED'].includes(code) ? 400 : ['VEHICLE_NOT_FOUND','RECORDING_NOT_FOUND'].includes(code) ? 404 : 502);
  }
}));
