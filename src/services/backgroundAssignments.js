// App-scoped work: route changes do not cancel a submitted PDF. File objects
// and signed tickets never enter localStorage or public UI snapshots.
export function createBackgroundAssignments(accountId = null) {
  const tasks = new Map(), listeners = new Set();
  let snapshot = [];
  function publish() {
    snapshot = [...tasks.values()].map(({ key, label, driverName, status, error }) =>
      ({ key, label, driverName, status, error }));
    for (const listener of listeners) listener();
  }
  const alive = task => tasks.get(task.key) === task;
  async function run(task) {
    task.status = 'pending'; task.error = ''; publish();
    let result;
    try {
      await Promise.resolve();
      if (!alive(task)) return;
      result = await task.perform(task.input);
    } catch (error) {
      if (!alive(task)) return;
      task.status = 'failed'; task.error = task.formatError(error); publish(); return;
    }
    if (!alive(task)) return;
    tasks.delete(task.key); publish();
    // Presentation failure after commit must never cause another send.
    try { task.confirmed(result, task.input); } catch { /* already committed */ }
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    start(options) {
      if (!options.key || tasks.has(options.key) || (accountId && options.input?.actorId !== accountId)) return false;
      const task = { ...options, status: 'pending', error: '' };
      tasks.set(task.key, task); void run(task); return true;
    },
    retry(key) {
      const task = tasks.get(key);
      if (!task || task.status !== 'failed') return false;
      void run(task); return true;
    },
    takeForReview(key) {
      const task = tasks.get(key);
      if (!task || task.status !== 'failed') return null;
      tasks.delete(key); publish(); return task.input;
    },
    dismiss(key) {
      if (tasks.get(key)?.status !== 'failed') return;
      tasks.delete(key); publish();
    },
    clear() { tasks.clear(); publish(); },
  };
}

export function backgroundAssignmentKey(load) {
  return load.review?.checksum || load.id || load.importRequestId;
}
