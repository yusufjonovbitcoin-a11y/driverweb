const sessionError = () => new Error('Sessiya topilmadi. Hisobga qayta kiring.');
const identityError = () => new Error('Hisob o‘zgardi. Amalni qayta bajaring.');

function assertIdentity(session, userId) {
  if (!session?.access_token || !session.user?.id) throw sessionError();
  if (userId && session.user.id !== userId) throw identityError();
  return session;
}

async function readSession(client, userId) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return assertIdentity(data?.session, userId);
}

async function refreshSession(client, session, { allowValidToken = false } = {}) {
  // Auth may have changed in another tab while the original request was pending.
  await readSession(client, session.user.id);
  const { data, error } = await client.auth.refreshSession();
  if (error) {
    // The SDK owns invalid-session removal. A transport error must never sign
    // out an otherwise valid session (or a different tab's new account).
    const retryable = error.name === 'AuthRetryableFetchError';
    if (!allowValidToken || !retryable || !Number.isFinite(session.expires_at)
      || session.expires_at * 1000 <= Date.now()) throw error;
    const current = await readSession(client, session.user.id);
    if (!Number.isFinite(current.expires_at) || current.expires_at * 1000 <= Date.now()) throw error;
    return current;
  }
  return assertIdentity(data?.session, session.user.id);
}

export async function invokeAuthenticatedFunction(client, name, body, options = {}) {
  const { onTiming, ...invokeOptions } = options;
  const timed = async (stage, work) => {
    if (!onTiming) return work();
    const started = performance.now();
    try { return await work(); }
    finally {
      // Diagnostics must never interrupt authentication or replay a request.
      try { onTiming?.({ stage, durationMs: performance.now() - started }); } catch { /* observer only */ }
    }
  };
  let session = await timed('session', () => readSession(client));
  if (!session.expires_at || session.expires_at * 1000 <= Date.now() + 5 * 60 * 1000) {
    session = await timed('refresh', () => refreshSession(client, session, { allowValidToken: true }));
  }
  const invoke = () => client.functions.invoke(name, {
    ...invokeOptions, body,
    headers: { ...invokeOptions.headers, Authorization: `Bearer ${session.access_token}` },
  });
  let result = await timed('request', invoke);
  if (result.error?.context?.status === 401) {
    session = await timed('retry_refresh', () => refreshSession(client, session));
    result = await timed('retry_request', invoke);
  }
  return result;
}
