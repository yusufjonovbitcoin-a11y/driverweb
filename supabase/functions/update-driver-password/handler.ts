import { driverPasswordAccess, passwordJson as json } from '../_shared/driver-password-access.ts';
import { driverPasswordError } from '../_shared/password-policy.ts';


// Keep the provider and the database injectable: security tests never reset a real account.
export async function handleDriverPassword(request: Request, deps: {
  createCaller: (authorization: string) => any;
  createAdmin: () => any;
  requireMfa: (authorization: string) => Promise<void>;
  checkLimit: (admin: any, actor: string) => Promise<{ allowed: boolean; unavailable?: boolean; retryAfterSeconds: number }>;
}) {
  try {
    const access = await driverPasswordAccess(request, deps);
    if (access instanceof Response) return access;
    const { actor, driverId, body } = access;
    const password = body.password;
    if (typeof password !== 'string' || driverPasswordError(password)) return json({ error: 'INVALID_PASSWORD' }, 400);
    const admin = deps.createAdmin();
    const limit = await deps.checkLimit(admin, actor.id);
    if (!limit.allowed) return json({ error: limit.unavailable ? 'SERVICE_UNAVAILABLE' : 'RATE_LIMITED' }, limit.unavailable ? 503 : 429, { 'Retry-After': String(limit.retryAfterSeconds) });

    const { data: readiness, error: readinessError } = await admin.rpc('read_driver_password_secret', { p_actor: actor.id, p_driver: driverId, p_reveal: false });
    if (readinessError || typeof readiness?.available !== 'boolean') return json({ error: 'SERVICE_UNAVAILABLE' }, 503);

    // Log intent before mutation; an audit failure must prevent a credential reset.
    // Never put a password, hash, token or request body into audit data.
    const { error: auditError } = await admin.from('audit_events').insert({
      company_id: actor.company_id, actor_id: actor.id, action: 'driver.password_reset_requested',
      entity_type: 'profile', entity_id: driverId, metadata: { source: 'driver_settings' },
    });
    if (auditError) return json({ error: 'SERVICE_UNAVAILABLE' }, 503);
    const { data, error } = await admin.auth.admin.updateUserById(driverId, { password });
    if (error) return json({ error: ['weak_password', 'same_password'].includes(error.code) ? 'PASSWORD_REJECTED' : 'PASSWORD_UPDATE_FAILED' }, 422);
    if (data?.user?.id !== driverId) return json({ error: 'PASSWORD_UPDATE_FAILED' }, 502);
    // A provider reset has already succeeded: report retention separately so a Vault
    // outage cannot misleadingly claim that the password itself was not changed.
    let retained = false;
    try {
      const result = await admin.rpc('store_driver_password_secret', { p_actor: actor.id, p_driver: driverId, p_password: password });
      retained = !result.error && result.data === true;
    } catch { /* Never log a credential-bearing request or provider exception. */ }
    return json({ ok: true, retained });
  } catch {
    // Provider errors can contain request data. Return only a fixed safe code.
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503);
  }
}
