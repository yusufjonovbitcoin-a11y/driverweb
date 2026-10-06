// Signed URLs stay in memory and belong to one authenticated actor at a time.
export function createMediaUrlCache({ ttlMs = 50 * 60_000, maxEntries = 500, now = Date.now } = {}) {
  const entries = new Map();
  let scope = null;
  let generation = 0;
  const staleSession = () => new DOMException('Media session changed.', 'AbortError');
  const clear = () => { entries.clear(); generation += 1; };

  return {
    setScope(next) {
      if (scope !== next) { scope = next; clear(); }
    },
    clear,
    delete(key) { entries.delete(key); },
    load(key, resolve) {
      if (!scope) return Promise.reject(staleSession());
      const cached = entries.get(key);
      if (cached && cached.until > now()) return cached.promise;
      const started = generation;
      const entry = { until: now() + ttlMs, promise: null };
      entry.promise = Promise.resolve().then(() => {
        if (started !== generation) throw staleSession();
        return resolve();
      }).then((value) => {
        if (started !== generation) throw staleSession();
        const url = typeof value === 'string' ? value : value?.url;
        const expires = value && typeof value === 'object' ? Date.parse(value.expiresAt) : NaN;
        if (Number.isFinite(expires)) entry.until = Math.min(entry.until, expires - 30_000);
        if (!url && entries.get(key) === entry) entries.delete(key);
        return url || null;
      }).catch((error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
  };
}

const clientCaches = new WeakMap();

function cacheFor(client) {
  let state = clientCaches.get(client);
  if (!state) {
    state = { cache: createMediaUrlCache(), actor: null, authVersion: 0 };
    clientCaches.set(client, state);
    // Synchronous only: Supabase holds its auth lock during this callback.
    client.auth.onAuthStateChange((event, session) => {
      state.authVersion += 1;
      state.actor = session?.user?.id || null;
      state.cache.setScope(state.actor);
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') state.cache.clear();
    });
  }
  return state;
}

export async function cachedSignedMediaUrl(client, key, resolve) {
  const state = cacheFor(client);
  const version = state.authVersion;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const actor = data.session?.user?.id || null;
  // A session lookup started before logout/account switching must not restore
  // the previous actor's cache after the auth event has already cleared it.
  if (version !== state.authVersion && actor !== state.actor) {
    throw new DOMException('Media session changed.', 'AbortError');
  }
  state.actor = actor;
  state.cache.setScope(actor);
  return state.cache.load(key, resolve);
}

export function invalidateSignedMediaUrl(client, key) {
  clientCaches.get(client)?.cache.delete(key);
}
