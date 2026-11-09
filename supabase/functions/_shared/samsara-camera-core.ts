import { SAMSARA_API, SamsaraError } from './samsara-core.ts';

export const CAMERA_INPUTS = ['dashcamRoadFacing', 'dashcamDriverFacing', 'analog1', 'analog2', 'analog3', 'analog4'];
export const requestIdValid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const invalid = () => { throw new SamsaraError('INVALID_REQUEST'); };
function instant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  return Date.parse(value);
}
export function cameraSelection(body: Record<string, unknown>, vehicles: {id: string}[]) {
  if (typeof body.vehicleId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.vehicleId) || !vehicles.some(v => v.id === body.vehicleId)) throw new SamsaraError('VEHICLE_NOT_FOUND');
  if (typeof body.input !== 'string' || !CAMERA_INPUTS.includes(body.input)) return invalid();
  return { vehicleId: body.vehicleId, input: body.input };
}
export function cameraRange(body: Record<string, unknown>, create = false, now = Date.now()) {
  const start = instant(body.startTime), end = instant(body.endTime);
  if (start > now || end > now || start > end) throw new SamsaraError('INVALID_TIME_RANGE');
  if (create) {
    if (body.mediaType !== 'image' && body.mediaType !== 'videoHighRes') return invalid();
    if ((body.mediaType === 'image' && end !== start) || (body.mediaType === 'videoHighRes' && (end-start < 1000 || end-start > 30000))) throw new SamsaraError('INVALID_TIME_RANGE');
  } else if (end <= start || end-start > 86400000) throw new SamsaraError('INVALID_TIME_RANGE');
  return { startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() };
}
// Temporary provider media links, never OAuth tokens. No server-side URL fetch.
export function safeCameraUrl(value: unknown) {
  try {
    if (typeof value !== 'string' || value.length > 12000) return null;
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    if (!['amazonaws.com', 'samsara.com', 'samsara.net'].some(host => u.hostname === host || u.hostname.endsWith(`.${host}`))) return null;
    return u.href;
  } catch { return null; }
}
export function normalizeCameraMedia(raw: unknown, vehicleId: string, input?: string) {
  if (!Array.isArray(raw)) throw new SamsaraError('INVALID_RESPONSE');
  const aliases: Record<string,string> = { dashcamForwardFacing:'dashcamRoadFacing', dashcamInwardFacing:'dashcamDriverFacing' };
  return raw.filter(v => v && String(v.vehicleId) === vehicleId).flatMap(v => {
    const camera = aliases[v.input] || v.input;
    if (!CAMERA_INPUTS.includes(camera) || (input && camera !== input)) return [];
    if (!['image','videoHighRes','videoLowRes','hyperlapse'].includes(v.mediaType)) return [];
    if (!Number.isFinite(Date.parse(v.startTime)) || !Number.isFinite(Date.parse(v.endTime))) return [];
    const url = safeCameraUrl(v.urlInfo?.url);
    const expiry = Date.parse(v.urlInfo?.urlExpiryTime);
    const available = url && Number.isFinite(expiry) && expiry > Date.now();
    const status = ['available','invalid','pending','failed','unavailable'].includes(v.status) ? v.status : 'available';
    return [{ vehicleId, input:camera, mediaType:v.mediaType, startTime:v.startTime, endTime:v.endTime,
      status:status === 'available' && !available ? 'link_unavailable' : status,
      url:status === 'available' && available ? url : null, expiresAt:available ? v.urlInfo.urlExpiryTime : null }];
  });
}
export async function cameraApi(path: string, accessToken: string, body?: unknown, fetcher: typeof fetch = fetch) {
  const u = new URL(path, SAMSARA_API);
  if (u.origin !== SAMSARA_API || !['/cameras/media','/cameras/media/retrieval'].includes(u.pathname)) throw new SamsaraError('INVALID_ENDPOINT');
  const response = await fetcher(u, { method:body ? 'POST':'GET', redirect:'error', signal:AbortSignal.timeout(20000),
    headers:{ Authorization:`Bearer ${accessToken}`, ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  if (!response.ok) throw new SamsaraError(response.status === 403 ? (body ? 'CAMERA_WRITE_REQUIRED':'CAMERA_READ_REQUIRED') : response.status === 401 ? 'RECONNECT_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : response.status === 404 ? 'RECORDING_NOT_FOUND' : response.status === 400 ? 'CAMERA_REQUEST_REJECTED' : 'PROVIDER_UNAVAILABLE');
  const result = await response.json();
  if (!result.data || typeof result.data !== 'object') throw new SamsaraError('INVALID_RESPONSE');
  return result;
}
