import { emptyPushPreferences, hasPushCategory, normalizePushPreferences, withPushDeadline } from './webPushPreferences.js';

// Serialises SDK / database work, including a logout racing a permission prompt.
// Dependencies are injected so account races can be tested without sending pushes.
export function createWebPushController(deps) {
  let account = null;
  let epoch = 0;
  let queue = Promise.resolve();
  const serial = (fn) => {
    const next = queue.then(() => deps.lock ? deps.lock(fn) : fn());
    queue = next.catch(() => {});
    return next;
  };
  const bounded = (operation) => withPushDeadline(operation, deps.timeoutMs ?? 20_000);
  const worker = (userId, preferences) => bounded(deps.setWorkerPreferences({ userId,
    ...preferences, enabled: Boolean(userId && hasPushCategory(preferences)) }));
  async function revoke(owner, clearAccount = false, pendingToken = null) {
    // A worker update/timeout must not prevent the actual endpoint revocation.
    await worker(clearAccount ? null : owner, emptyPushPreferences).catch(() => {});
    const tokens = [...new Set([deps.readToken(), pendingToken].filter(Boolean))];
    let databaseError;
    if (tokens.length && owner && await bounded(deps.sessionUserId()).catch(() => null) === owner) {
      for (const token of tokens) {
        try { await bounded(deps.unregister(token)); } catch (error) { databaseError = error; }
      }
    }
    // Revoking the browser subscription also makes failed DB revocations safe.
    await bounded(deps.deleteToken());
    deps.saveToken(null);
    return { databaseRevoked: !databaseError };
  }
  async function registerToken(owner, token, preferences) {
    const previous = deps.readToken();
    if (previous && previous !== token) {
      if (await bounded(deps.sessionUserId()) !== owner) throw new Error('signedOut');
      // Only this browser's old token: other browser/device rows stay intact.
      await bounded(deps.unregister(previous));
    }
    await bounded(deps.register(token, preferences));
  }
  function setAccount(id) {
    if (account === id) return;
    const previous = account;
    account = id; epoch += 1;
    void serial(() => previous ? revoke(previous, true) : worker(id, emptyPushPreferences)).catch(() => {});
  }
  function disable() {
    const owner = account;
    epoch += 1;
    // Fail closed even if the remote endpoint revocation later fails.
    let persistenceError;
    try { if (owner) deps.savePreferences(owner, emptyPushPreferences); } catch (error) { persistenceError = error; }
    return serial(async () => {
      const result = await revoke(owner);
      if (persistenceError) throw persistenceError;
      return result;
    });
  }
  function updatePreferences(value, { requestPermission = false, category = null } = {}) {
    let preferences = normalizePushPreferences(value);
    if (category && !['calls', 'messages'].includes(category)) return Promise.reject(new Error('invalidCategory'));
    if (!category && !hasPushCategory(preferences)) return disable().then(() => true);
    const owner = account;
    const version = ++epoch;
    if (!owner) return Promise.reject(new Error('signedOut'));
    // Invoke from the click stack, before SDK loading/network awaits (Safari).
    const permission = requestPermission && deps.permission() !== 'granted'
      ? deps.requestPermission() : Promise.resolve(deps.permission());
    return permission.then((value) => {
      if (value !== 'granted') throw new Error(value === 'denied' ? 'denied' : 'off');
      return serial(async () => {
        const current = () => account === owner && epoch === version;
        if (!current()) return false;
        let pendingToken;
        try {
          // A category click changes only that category. Another tab may have
          // changed the other one while this operation waited for the lock.
          if (category) preferences = { ...normalizePushPreferences(deps.readPreferences(owner)), [category]: preferences[category] };
          if (!hasPushCategory(preferences)) {
            await revoke(owner);
            if (!current()) return false;
            deps.savePreferences(owner, preferences);
            return true;
          }
          // An old worker may not know v2 acknowledgements yet. Revoke its
          // endpoint, then getToken updates the worker before enabling v2.
          await worker(owner, emptyPushPreferences).catch(() => revoke(owner));
          const token = await bounded(deps.getToken());
          pendingToken = token;
          if (!current()) { await bounded(deps.deleteToken()); return false; }
          // Session is checked immediately before writing, not from a stale UI closure.
          if (await bounded(deps.sessionUserId()) !== owner) throw new Error('signedOut');
          await registerToken(owner, token, preferences);
          if (!current()) { await revoke(owner, false, pendingToken); return false; }
          await worker(owner, preferences);
          if (!current() || await bounded(deps.sessionUserId()) !== owner) { await revoke(owner, false, pendingToken); return false; }
          deps.saveToken(token);
          // Only a fully registered and acknowledged config becomes durable.
          deps.savePreferences(owner, preferences);
          return true;
        } catch (error) {
          await revoke(owner, false, pendingToken).catch(() => {});
          throw error;
        }
      });
    });
  }
  const enable = ({ requestPermission = false, preferences = { calls: true, messages: true } } = {}) =>
    updatePreferences(preferences, { requestPermission });
  function refresh() {
    const owner = account;
    const version = epoch;
    return serial(async () => {
      const current = () => account === owner && epoch === version;
      if (!owner || !current()) return false;
      const read = () => normalizePushPreferences(deps.readPreferences(owner));
      // Read AFTER the cross-tab lock: a queued refresh is not a user edit.
      if (!hasPushCategory(read())) { await revoke(owner); return true; }
      if (deps.permission() !== 'granted') throw new Error(deps.permission() === 'denied' ? 'denied' : 'off');
      let pendingToken;
      try {
        const token = await bounded(deps.getToken());
        pendingToken = token;
        if (!current()) return false;
        if (await bounded(deps.sessionUserId()) !== owner) throw new Error('signedOut');
        const registeredPreferences = read();
        if (!hasPushCategory(registeredPreferences)) { await revoke(owner); return true; }
        await registerToken(owner, token, registeredPreferences);
        if (!current()) { await revoke(owner, false, pendingToken); return false; }
        // A fail-closed disable may write preferences while waiting for lock.
        let latest = read();
        if (!hasPushCategory(latest)) { await revoke(owner, false, pendingToken); return true; }
        if (latest.calls !== registeredPreferences.calls || latest.messages !== registeredPreferences.messages) {
          await registerToken(owner, token, latest);
        }
        await worker(owner, latest);
        if (!current()) { await revoke(owner, false, pendingToken); return false; }
        const after = read();
        if (after.calls !== latest.calls || after.messages !== latest.messages) {
          latest = after;
          if (!hasPushCategory(latest)) { await revoke(owner, false, pendingToken); return true; }
          await registerToken(owner, token, latest);
          await worker(owner, latest);
        }
        if (!current() || await bounded(deps.sessionUserId()) !== owner) { await revoke(owner, false, pendingToken); return false; }
        deps.saveToken(token);
        // Deliberately NEVER savePreferences here: background sync cannot
        // overwrite another tab's later selection with its captured snapshot.
        return true;
      } catch (error) { await revoke(owner, false, pendingToken).catch(() => {}); throw error; }
    });
  }
  return { setAccount, enable, disable, updatePreferences, refresh };
}
