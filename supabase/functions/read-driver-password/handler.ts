import { driverPasswordAccess, passwordJson as json } from '../_shared/driver-password-access.ts';

export async function handleReadDriverPassword(request: Request, deps: {
  createCaller: (authorization: string) => any;
  createAdmin: () => any;
  requireMfa: (authorization: string) => Promise<void>;
  checkLimit: (admin: any, actor: string, reveal: boolean) => Promise<{ allowed: boolean; unavailable?: boolean; retryAfterSeconds: number }>;
}) {
  try {
    const access = await driverPasswordAccess(request, deps);
    if (access instanceof Response) return access;
    const { actor, driverId, body } = access;
    if (!['status', 'reveal'].includes(body.action)) return json({ error: 'INVALID_REQUEST' }, 400);
    const reveal = body.action === 'reveal';
    const admin = deps.createAdmin();
    const limit = await deps.checkLimit(admin, actor.id, reveal);
    if (!limit.allowed) return json({ error: limit.unavailable ? 'SERVICE_UNAVAILABLE' : 'RATE_LIMITED' }, limit.unavailable ? 503 : 429, { 'Retry-After': String(limit.retryAfterSeconds) });
    const { data, error } = await admin.rpc('read_driver_password_secret', { p_actor: actor.id, p_driver: driverId, p_reveal: reveal });
    if (error || typeof data?.available !== 'boolean') return json({ error: 'SERVICE_UNAVAILABLE' }, 503);
    if (!data.available) return json({ available: false });
    if (reveal && typeof data.password !== 'string') return json({ error: 'SERVICE_UNAVAILABLE' }, 503);
    return json({ available: true, updatedAt: data.updatedAt, ...(reveal ? { password: data.password } : {}) });
  } catch { return json({ error: 'SERVICE_UNAVAILABLE' }, 503); }
}
