export function createCoalescedAsyncTrigger(task, {
  delayMs = 250,
  maxWaitMs = 1_000,
} = {}) {
  let debounceTimer = null;
  let maxWaitTimer = null;
  let running = false;
  let queued = false;
  let disposed = false;

  const clearTimers = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
  };

  const run = async () => {
    if (disposed) return;
    clearTimers();
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
      if (queued && !disposed) {
        queued = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    if (disposed) return;
    if (running) {
      queued = true;
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void run(), delayMs);
    maxWaitTimer ??= setTimeout(() => void run(), maxWaitMs);
  };

  schedule.dispose = () => {
    disposed = true;
    queued = false;
    clearTimers();
  };
  return schedule;
}
