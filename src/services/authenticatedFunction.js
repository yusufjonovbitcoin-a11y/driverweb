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
  let session = await readSession(client);
  if (!session.expires_at || session.expires_at * 1000 <= Date.now() + 5 * 60 * 1000) {
    session = await refreshSession(client, session, { allowValidToken: true });
  }
  const invoke = () => client.functions.invoke(name, {
    ...options, body,
    headers: { ...options.headers, Authorization: `Bearer ${session.access_token}` },
  });
  let result = await invoke();
  if (result.error?.context?.status === 401) {
    session = await refreshSession(client, session);
    result = await invoke();
  }
  return result;
}
