const readyFields = 'assignment_id,load_id,driver_id,rate_per_mile,currency,loaded_miles,deadhead_miles,total_miles,amount';
const statuses = new Set(['awaiting_start', 'calculating', 'retry_wait', 'failed', 'ready']);
const parameters = scope => ({ p_assignment_id: scope.assignmentId, p_load_id: scope.loadId, p_driver_id: scope.driverId });
const accessDenied = error => [401, 403].includes(Number(error?.status ?? error?.statusCode))
  || ['42501', 'PGRST301', 'PGRST302', 'PGRST303', 'DRIVER_PAY_PERMISSION_DENIED', 'DRIVER_PAY_RETRY_PERMISSION_DENIED'].includes(error?.code)
  || /\bDRIVER_PAY_(?:RETRY_)?PERMISSION_DENIED\b/.test(error?.message || '');

// PostgREST carries HTTP status beside the error, not necessarily inside it.
function responseError(result) {
  if (!result.error && ![401, 403].includes(result.status)) return null;
  return Object.assign(new Error(result.error?.message || 'Driver pay request failed'), result.error, {
    status: result.status ?? result.error?.status,
  });
}

function normalizePay(row) {
  if (!row || !statuses.has(row.status)) throw new Error('DRIVER_PAY_INVALID_ROW');
  const rate = Number(row.ratePerMile);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100 || row.currency !== 'USD') throw new Error('DRIVER_PAY_INVALID_ROW');
  const pay = { status: row.status, ratePerMile: rate, currency: 'USD', loadedMiles: null,
    deadheadMiles: null, totalMiles: null, amount: null, canRetry: row.status !== 'ready' && row.canRetry === true,
    errorCode: typeof row.errorCode === 'string' ? row.errorCode : null };
  if (row.status === 'ready') {
    for (const key of ['loadedMiles', 'deadheadMiles', 'totalMiles', 'amount']) {
      const number = Number(row[key]);
      if (row[key] == null || !Number.isFinite(number) || number < 0) throw new Error('DRIVER_PAY_INVALID_ROW');
      pay[key] = number;
    }
    if (pay.loadedMiles <= 0 || pay.totalMiles <= 0) throw new Error('DRIVER_PAY_INVALID_ROW');
  }
  return pay;
}

export async function fetchAssignmentDriverPay(client, scope, signal) {
  if (!scope.assignmentId || !scope.loadId || !scope.driverId) return null;
  const result = await client.rpc('get_assignment_driver_pay', parameters(scope)).abortSignal(signal);
  const { data } = result, error = responseError(result);
  if (!error) return data == null ? null : normalizePay(data);
  if (accessDenied(error) || !['PGRST202', '42883'].includes(error.code)) throw error;
  // A pre-migration server can still show an immutable saved snapshot. Never
  // reconstruct pending/ready state from separate table reads across a commit.
  const legacy = await client.from('assignment_driver_pay').select(readyFields)
    .eq('assignment_id', scope.assignmentId).eq('load_id', scope.loadId).eq('driver_id', scope.driverId)
    .maybeSingle().abortSignal(signal);
  const legacyError = responseError(legacy);
  if (legacyError || !legacy.data) throw legacyError || error;
  const row = legacy.data;
  if (row.assignment_id !== scope.assignmentId || row.load_id !== scope.loadId || row.driver_id !== scope.driverId) {
    throw new Error('DRIVER_PAY_SCOPE_MISMATCH');
  }
  return normalizePay({ status: 'ready', currency: row.currency, ratePerMile: row.rate_per_mile,
    loadedMiles: row.loaded_miles, deadheadMiles: row.deadhead_miles, totalMiles: row.total_miles, amount: row.amount });
}

// This controller never supplies distance or money. Scope and request
// tokens keep late results out of another load's panel.
export function createAssignmentDriverPay({ scope, getClient, timeoutMs = 15_000 }) {
  let state = { pay: null, loaded: false, busy: false, error: null };
  let request = null;
  let refreshQueued = false;
  let retryOperationId = null;
  let deadline;
  const listeners = new Set();
  const update = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const begin = () => {
    if (request) return null;
    const controller = new AbortController(); request = controller;
    deadline = setTimeout(() => controller.abort(), timeoutMs);
    update({ busy: true, error: null });
    return controller;
  };
  const finish = controller => {
    if (request !== controller) return;
    clearTimeout(deadline);
    request = null; update({ busy: false });
    if (refreshQueued) { refreshQueued = false; void reader.load(); }
  };
  const guarded = (work, controller) => new Promise((resolve, reject) => {
    const abort = () => reject(new Error('DRIVER_PAY_REQUEST_ABORTED'));
    if (controller.signal.aborted) { abort(); return; }
    controller.signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
  });
  const accept = pay => {
    if (!pay && state.pay) throw new Error('DRIVER_PAY_SNAPSHOT_UNAVAILABLE');
    // A completed snapshot is immutable for this assignment.
    if (state.pay?.status === 'ready' && pay?.status !== 'ready') return;
    update({ pay, loaded: true, error: null });
  };
  const fail = (cause, kind) => {
    // A network outage may retain immutable data. An explicit access failure
    // cannot: company/driver permissions can change without changing user ID.
    if (accessDenied(cause)) {
      retryOperationId = null;
      update({ pay: null, error: kind });
    } else update({ error: kind });
  };

  const reader = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async load() {
      const controller = begin(); if (!controller) return false;
      try {
        const pay = await guarded(fetchAssignmentDriverPay(getClient(), scope, controller.signal), controller);
        if (request !== controller) return false;
        accept(pay);
        return true;
      } catch (cause) {
        if (request === controller) fail(cause, 'load');
        return false;
      } finally { finish(controller); }
    },
    refresh() {
      if (request) { refreshQueued = true; return; }
      void reader.load();
    },
    async retry() {
      if (!state.pay?.canRetry) return false;
      const controller = begin(); if (!controller) return false;
      try {
        const client = getClient();
        retryOperationId ||= crypto.randomUUID();
        const result = await guarded(client.rpc('retry_assignment_driver_pay', {
          ...parameters(scope), p_operation_id: retryOperationId,
        }).abortSignal(controller.signal), controller);
        const { data } = result, error = responseError(result);
        if (error) throw error;
        if (request !== controller) return false;
        accept(normalizePay(data));
        retryOperationId = null;
        return true;
      } catch (cause) {
        if (request === controller) fail(cause, 'retry');
        return false;
      } finally { finish(controller); }
    },
    dispose() {
      const previous = request; request = null; refreshQueued = false; previous?.abort();
      clearTimeout(deadline);
      state = { ...state, busy: false };
    },
    clear() {
      reader.dispose(); retryOperationId = null;
      update({ pay: null, loaded: false, busy: false, error: 'load' });
    },
  };
  return reader;
}

// Realtime is a hint to re-read the atomic snapshot, never a source of money.
// The visible-only fallback is bounded to one request per 30 seconds and stops
// requesting after a terminal state or an authoritative initial no-pay result.
export function observeAssignmentDriverPay(reader, client, scope, {
  windowTarget = globalThis.window, documentTarget = globalThis.document,
  setIntervalFn = globalThis.setInterval, clearIntervalFn = globalThis.clearInterval,
} = {}) {
  let active = true;
  const visible = () => documentTarget?.visibilityState !== 'hidden';
  const refresh = () => { if (active && visible()) reader.refresh(); };
  let channel;
  try {
    channel = client.channel(`assignment-pay:${scope.assignmentId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assignments', filter: `id=eq.${scope.assignmentId}` }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
  } catch { /* Focus and bounded polling remain available without Realtime. */ }
  windowTarget?.addEventListener('focus', refresh);
  windowTarget?.addEventListener('online', refresh);
  documentTarget?.addEventListener('visibilitychange', refresh);
  const timer = setIntervalFn(() => {
    const { pay, loaded, error } = reader.getSnapshot();
    if (pay?.status === 'ready' || (pay?.status === 'failed' && (pay.canRetry
      || !['DRIVER_PAY_PROVIDER_UNAVAILABLE', 'DRIVER_PAY_WORKER_TIMEOUT'].includes(pay.errorCode)))
      || (loaded && !pay && !error)) return;
    refresh();
  }, 30_000);
  let authSubscription;
  const stop = () => {
    if (!active) return;
    active = false; clearIntervalFn(timer);
    windowTarget?.removeEventListener('focus', refresh);
    windowTarget?.removeEventListener('online', refresh);
    documentTarget?.removeEventListener('visibilitychange', refresh);
    if (channel) void client.removeChannel(channel);
    authSubscription?.unsubscribe();
    reader.dispose();
  };
  let authUserId;
  authSubscription = client.auth?.onAuthStateChange((event, session) => {
    const nextId = session?.user?.id ?? null;
    if (event === 'INITIAL_SESSION') { authUserId = nextId; return; }
    if (event === 'SIGNED_OUT' || (authUserId != null && nextId !== authUserId)
      || (event === 'SIGNED_IN' && authUserId == null)) {
      stop(); reader.clear();
    } else if (nextId) authUserId = nextId;
  }).data.subscription;
  if (!active) authSubscription?.unsubscribe();
  return stop;
}
