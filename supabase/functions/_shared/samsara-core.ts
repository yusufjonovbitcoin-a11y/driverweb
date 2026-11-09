// Provider-specific helpers are deliberately independent of the database/runtime.
export const SAMSARA_API = 'https://api.samsara.com';
export const RETURN_ORIGINS = new Set(['https://managefleets.com', 'https://www.managefleets.com', 'http://127.0.0.1:5174', 'http://localhost:5174']);
export function returnOrigin(input: unknown) {
  return typeof input === 'string' && RETURN_ORIGINS.has(input) ? input : 'https://managefleets.com';
}
export function returnLocation(origin: string, result: string) {
  return `${returnOrigin(origin)}/#profile?section=integrations&samsara=${encodeURIComponent(result)}`;
}
export function authorizationUrl(clientId: string, state: string, redirectUri: string) {
  return `${SAMSARA_API}/oauth2/authorize?${new URLSearchParams({ client_id: clientId, state, response_type: 'code', redirect_uri: redirectUri })}`;
}
export async function stateHash(state: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function randomState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function sameSecret(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const [a,b] = await Promise.all([stateHash(actual), stateHash(expected)]);
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function encryptionKey(secret: string) {
  const bytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('SAMSARA_CONFIG');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(value: unknown, company: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:new TextEncoder().encode(company) }, await encryptionKey(secret), new TextEncoder().encode(JSON.stringify(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(data)))}`;
}
export async function unseal(value: string, company: string, secret: string) {
  const [iv, data] = value.split('.').map(part => Uint8Array.from(atob(part), c => c.charCodeAt(0)));
  const clear = await crypto.subtle.decrypt({ name:'AES-GCM', iv, additionalData:new TextEncoder().encode(company) }, await encryptionKey(secret), data);
  return JSON.parse(new TextDecoder().decode(clear));
}
export class SamsaraError extends Error {
  constructor(public code: string) { super(code); }
}
export type Credentials = { access_token: string; refresh_token: string; expires_in: number };
export async function exchangeToken(clientId: string, secret: string, body: Record<string,string>, fetcher: typeof fetch = fetch): Promise<Credentials> {
  const response = await fetcher(`${SAMSARA_API}/oauth2/token`, { method:'POST', redirect:'error', signal:AbortSignal.timeout(30000),
    headers:{ Authorization:`Basic ${btoa(`${clientId}:${secret}`)}`, 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams(body) });
  if (!response.ok) throw new SamsaraError(response.status === 400 || response.status === 401 ? 'RECONNECT_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE');
  const data = await response.json();
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new SamsaraError('INVALID_RESPONSE');
  return {access_token:data.access_token,refresh_token:data.refresh_token,expires_in:data.expires_in};
}
export async function readPages(path: string, accessToken: string, fetcher: typeof fetch = fetch, deadline = Date.now()+65000) {
  const records: Record<string, any>[] = []; // Samsara uses heterogeneous endpoint schemas.
  const seen = new Set<string>();
  let after = '';
  for (let page=0;page<30;page++) {
    if (Date.now() >= deadline) throw new SamsaraError('SYNC_LIMIT');
    const url = new URL(path, SAMSARA_API);
    if (url.origin !== SAMSARA_API || !url.pathname.startsWith('/fleet/')) throw new SamsaraError('INVALID_ENDPOINT');
    if (after) url.searchParams.set('after', after);
    const response = await fetcher(url, { headers:{Authorization:`Bearer ${accessToken}`}, signal:AbortSignal.timeout(Math.min(15000, deadline-Date.now())), redirect:'error' });
    if (!response.ok) throw new SamsaraError(response.status === 401 ? 'RECONNECT_REQUIRED' : response.status === 403 ? 'SCOPE_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE');
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new SamsaraError('INVALID_RESPONSE');
    records.push(...result.data);
    if (!result.pagination?.hasNextPage) return records;
    after = result.pagination.endCursor;
    if (typeof after !== 'string' || !after || seen.has(after)) throw new SamsaraError('INVALID_RESPONSE');
    seen.add(after);
  }
  throw new SamsaraError('SYNC_LIMIT');
}
const label = (v: unknown) => typeof v === 'string' ? v.slice(0,240) : '';
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function normalizeFleet(drivers: Record<string,any>[], vehicles: Record<string,any>[], gps: Record<string,any>[], hos: Record<string,any>[]) {
  const stats = new Map(gps.map(row => [String(row.id), row.gps]));
  const clocks = new Map(hos.map(row => [String(row.driver?.id), row]));
  return {
    drivers: drivers.map(driver => {
      const h = clocks.get(String(driver.id));
      return { id:String(driver.id), name:label(driver.name), vehicleId:h?.currentVehicle?.id ? String(h.currentVehicle.id) : null,
        dutyStatus:label(h?.currentDutyStatus?.hosStatusType), driveRemainingMs:finite(h?.clocks?.drive?.driveRemainingDurationMs), shiftRemainingMs:finite(h?.clocks?.shift?.shiftRemainingDurationMs) };
    }),
    vehicles: vehicles.map(vehicle => {
      const g = stats.get(String(vehicle.id));
      const lat = finite(g?.latitude), lng = finite(g?.longitude);
      const valid = lat !== null && lng !== null && Math.abs(lat)<=90 && Math.abs(lng)<=180;
      return { id:String(vehicle.id), name:label(vehicle.name), vin:label(vehicle.vin), latitude:valid?lat:null, longitude:valid?lng:null,
        location:label(g?.reverseGeo?.formattedLocation), gpsAt:valid && Number.isFinite(Date.parse(g?.time)) ? g.time : null, speedMph:finite(g?.speedMilesPerHour) };
    }),
  };
}
export function errorCode(error: unknown) {
  return error instanceof SamsaraError ? error.code : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL_ERROR';
}
