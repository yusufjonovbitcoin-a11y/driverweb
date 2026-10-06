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
  function setAccount(id) {
    if (account !== id) { account = id; epoch += 1; }
  }
  async function disable() {
    const owner = account;
    epoch += 1;
    deps.saveEnabled(owner, false);
    return serial(async () => {
      // A worker update/timeout must not prevent the actual endpoint revocation.
      await deps.setWorkerEnabled(false).catch(() => {});
      const token = deps.readToken();
      let databaseError;
      if (token && owner) {
        try { await deps.unregister(token); } catch (error) { databaseError = error; }
      }
      // Revoking the browser subscription also makes failed DB revocations safe.
      await deps.deleteToken();
      deps.saveToken(null);
      return { databaseRevoked: !databaseError };
    });
  }
  function enable({ requestPermission = false } = {}) {
    const owner = account;
    const version = epoch;
    if (!owner) return Promise.reject(new Error('signedOut'));
    // Invoke from the click stack, before SDK loading/network awaits (Safari).
    const permission = requestPermission ? deps.requestPermission() : Promise.resolve(deps.permission());
    return permission.then((value) => {
      if (value !== 'granted') throw new Error(value === 'denied' ? 'denied' : 'off');
      return serial(async () => {
        const current = () => account === owner && epoch === version;
        if (!current()) return false;
        await deps.setWorkerEnabled(false);
        const token = await deps.getToken();
        if (!current()) { await deps.deleteToken(); return false; }
        try {
          // Session is checked immediately before writing, not from a stale UI closure.
          if (await deps.sessionUserId() !== owner) throw new Error('signedOut');
          await deps.register(token);
          if (!current()) { await deps.unregister(token); await deps.deleteToken(); return false; }
          deps.saveToken(token);
          deps.saveEnabled(owner, true);
          await deps.setWorkerEnabled(true);
          return true;
        } catch (error) {
          deps.saveEnabled(owner, false);
          await deps.deleteToken().catch(() => {});
          throw error;
        }
      });
    });
  }
  return { setAccount, enable, disable };
}
