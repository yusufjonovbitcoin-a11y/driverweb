// One bounded, retryable history request per mounted conversation. A timeout
// invalidates late responses even if the underlying transport cannot abort.
export function createChatRecovery({ load, onState, timeoutMs = 20000, retryDelays = [1000, 3000] }) {
  let closed = false;
  let generation = 0;
  let pending = null;
  let retryTimer;
  let cancelAttempt;
  let failures = 0;
  function run(automatic = false) {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    clearTimeout(retryTimer);
    if (!automatic) failures = 0;
    const token = ++generation;
    const current = () => !closed && generation === token;
    onState({ loading: true, error: null });
    let timeout;
    const deadline = new Promise((_, reject) => {
      cancelAttempt = () => reject(new Error('CHAT_REQUEST_CANCELLED'));
      timeout = setTimeout(() => reject(new Error('CHAT_REQUEST_TIMEOUT')), timeoutMs);
    });
    pending = Promise.race([Promise.resolve().then(() => load(current)), deadline])
      .then(() => { if (current()) { failures = 0; onState({ loading: false, error: null }); } })
      .catch((error) => {
        if (!current()) return;
        generation++;
        onState({ loading: false, error });
        if (failures < retryDelays.length) retryTimer = setTimeout(() => { void run(true); }, retryDelays[failures++]);
      })
      .finally(() => { clearTimeout(timeout); pending = null; cancelAttempt = null; });
    return pending;
  }
  return { run: () => run(), dispose() { closed = true; generation++; clearTimeout(retryTimer); cancelAttempt?.(); } };
}
