// Callers arriving during a request share one trailing refresh. In particular,
// a mutation must wait for a read started AFTER it, not reuse a stale in-flight read.
export function createSerializedRefresh(task) {
  let pending = null;
  let queued = false;
  return () => {
    if (pending) {
      queued = true;
      return pending;
    }
    pending = Promise.resolve().then(async () => {
      try {
        do {
          queued = false;
          await task();
        } while (queued);
      } finally {
        // Clear in the same microtask as the final queue check. A chained
        // finally leaves a gap where a new caller can join a finished run.
        pending = null;
      }
    });
    return pending;
  };
}
