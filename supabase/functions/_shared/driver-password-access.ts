export const passwordJson = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', ...extra },
});

export async function driverPasswordAccess(request: Request, deps: {
  createCaller: (authorization: string) => any;
  requireMfa: (authorization: string) => Promise<void>;
}) {
  if (request.method !== 'POST') return passwordJson({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return passwordJson({ error: 'UNAUTHORIZED' }, 401);
  const caller = deps.createCaller(authorization);
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth?.user?.id) return passwordJson({ error: 'UNAUTHORIZED' }, 401);
  try { await deps.requireMfa(authorization); }
  catch { return passwordJson({ error: 'MFA_REQUIRED' }, 403); }
  const { data: actor, error: actorError } = await caller.from('profiles')
    .select('id,company_id,role,status').eq('id', auth.user.id).single();
  if (actorError || actor?.id !== auth.user.id || actor?.role !== 'company_admin' || actor.status !== 'active' || !actor.company_id) {
    return passwordJson({ error: 'FORBIDDEN' }, 403);
  }
  const reader = request.body?.getReader();
  if (!reader) return passwordJson({ error: 'INVALID_REQUEST' }, 400);
  const decoder = new TextDecoder();
  let text = ''; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return passwordJson({ error: 'INVALID_REQUEST' }, 413); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let body;
  try { body = JSON.parse(text); } catch { return passwordJson({ error: 'INVALID_REQUEST' }, 400); }
  const driverId = body?.driverId;
  if (typeof driverId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(driverId) || driverId === actor.id) return passwordJson({ error: 'INVALID_REQUEST' }, 400);
  const { data: target, error: targetError } = await caller.from('profiles')
    .select('id,company_id,role,status').eq('id', driverId).eq('company_id', actor.company_id).eq('role', 'driver').maybeSingle();
  if (targetError || target?.id !== driverId || target.company_id !== actor.company_id || target.role !== 'driver' || !['active', 'suspended'].includes(target.status)) {
    return passwordJson({ error: 'DRIVER_NOT_FOUND' }, 404);
  }
  return { actor, driverId, body };
}
