import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssignmentDriverPay, fetchAssignmentDriverPay, observeAssignmentDriverPay } from './assignmentDriverPay.js';

const scope = { assignmentId: 'assignment-a', loadId: 'load-a', driverId: 'driver-a' };
const args = { p_assignment_id: 'assignment-a', p_load_id: 'load-a', p_driver_id: 'driver-a' };
const pending = { status: 'awaiting_start', ratePerMile: '0.7855', currency: 'USD', loadedMiles: null,
  deadheadMiles: null, totalMiles: null, amount: null, canRetry: false, errorCode: null };
const ready = { ...pending, status: 'ready', loadedMiles: 100, deadheadMiles: 20, totalMiles: 120, amount: 94.26 };
const failed = { ...pending, status: 'failed', canRetry: true, errorCode: 'DRIVER_PAY_PROVIDER_UNAVAILABLE' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const calls = [], signals = [], tableReads = [];
  let result = { data: pending }, retryResult = { data: { ...pending, status: 'calculating' } }, legacy = { data: null };
  let onChange, onSubscription, onAuth, removed = 0, authRemoved = 0;
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return { abortSignal(signal) { signals.push(signal); return Promise.resolve(name === 'retry_assignment_driver_pay' ? retryResult : result); } };
    },
    from(table) {
      const read = { table, filters: [] }; tableReads.push(read);
      return { select() { return this; }, eq(...filter) { read.filters.push(filter); return this; },
        maybeSingle() { return this; }, abortSignal() { return Promise.resolve(legacy); } };
    },
    channel(name) {
      const channel = { name, on(event, filter, callback) { channel.filter = filter; onChange = callback; return channel; },
        subscribe(callback) { onSubscription = callback; return channel; } };
      client.lastChannel = channel; return channel;
    },
    removeChannel(channel) { assert.equal(channel, client.lastChannel); removed += 1; },
    auth: { onAuthStateChange(callback) { onAuth = callback; return { data: { subscription: { unsubscribe() { authRemoved += 1; } } } }; } },
  };
  return { client, calls, signals, tableReads, reader: createAssignmentDriverPay({ scope, getClient: () => client, ...options }),
    setResult(value) { result = value; }, setRetryResult(value) { retryResult = value; }, setLegacy(value) { legacy = value; },
    changed() { onChange(); }, subscribed() { onSubscription('SUBSCRIBED'); },
    auth(event, id) { onAuth(event, id ? { user: { id } } : null); },
    get removed() { return removed; }, get authRemoved() { return authRemoved; } };
}

test('atomic RPC scopes every identifier and never performs dual table reads', async () => {
  const setup = fixture();
  const pay = await fetchAssignmentDriverPay(setup.client, scope, new AbortController().signal);
  assert.deepEqual(setup.calls, [{ name: 'get_assignment_driver_pay', params: args }]);
  assert.equal(setup.tableReads.length, 0);
  assert.deepEqual(pay, { ...pending, ratePerMile: 0.7855 });
  assert.equal(await fetchAssignmentDriverPay(setup.client, { ...scope, assignmentId: null }), null);
  assert.equal(setup.calls.length, 1);
});

test('server lifecycle states keep unknown amounts null; only ready exposes money', async () => {
  const setup = fixture();
  for (const status of ['awaiting_start', 'calculating', 'retry_wait', 'failed']) {
    setup.setResult({ data: { ...pending, status, amount: 0, loadedMiles: 0 } });
    const pay = await fetchAssignmentDriverPay(setup.client, scope);
    assert.equal(pay.amount, null); assert.equal(pay.loadedMiles, null); assert.equal(pay.status, status);
  }
  setup.setResult({ data: ready });
  assert.equal((await fetchAssignmentDriverPay(setup.client, scope)).amount, 94.26);
  setup.setResult({ data: { ...ready, amount: null } });
  await assert.rejects(fetchAssignmentDriverPay(setup.client, scope), /INVALID_ROW/);
  setup.setResult({ data: { ...pending, status: 'invented' } });
  await assert.rejects(fetchAssignmentDriverPay(setup.client, scope), /INVALID_ROW/);
});

test('missing RPC fallback reads only immutable ready compensation with exact scope', async () => {
  const setup = fixture(); setup.setResult({ error: { code: 'PGRST202' } });
  const row = { assignment_id: scope.assignmentId, load_id: scope.loadId, driver_id: scope.driverId,
    currency: 'USD', rate_per_mile: '0.7855', loaded_miles: 100, deadhead_miles: 20, total_miles: 120, amount: 94.26 };
  setup.setLegacy({ data: row });
  assert.equal((await fetchAssignmentDriverPay(setup.client, scope)).amount, 94.26);
  assert.deepEqual(setup.tableReads[0], { table: 'assignment_driver_pay', filters: [
    ['assignment_id', scope.assignmentId], ['load_id', scope.loadId], ['driver_id', scope.driverId],
  ] });
  setup.setLegacy({ data: { ...row, driver_id: 'foreign' } });
  await assert.rejects(fetchAssignmentDriverPay(setup.client, scope), /SCOPE_MISMATCH/);
  setup.setLegacy({ data: null });
  await assert.rejects(fetchAssignmentDriverPay(setup.client, scope), error => error.code === 'PGRST202');
  setup.setResult({ error: { code: '42501' } });
  const count = setup.tableReads.length;
  await assert.rejects(fetchAssignmentDriverPay(setup.client, scope), error => error.code === '42501');
  assert.equal(setup.tableReads.length, count, 'Permission errors never fall back');
});

test('transient empty snapshots cannot hide known pay; completed compensation cannot regress', async () => {
  const setup = fixture(); const snapshots = [];
  const unsubscribe = setup.reader.subscribe(() => snapshots.push(setup.reader.getSnapshot()));
  await setup.reader.load(); setup.setResult({ data: null });
  assert.equal(await setup.reader.load(), false);
  assert.equal(setup.reader.getSnapshot().pay.status, 'awaiting_start');
  assert.equal(setup.reader.getSnapshot().error, 'load');
  setup.setResult({ data: ready }); await setup.reader.load();
  setup.setResult({ data: pending }); await setup.reader.load();
  assert.equal(setup.reader.getSnapshot().pay.amount, 94.26);
  assert.ok(snapshots.some(state => state.pay?.status === 'ready'));
  unsubscribe();
  const noPay = fixture(); noPay.setResult({ data: null }); await noPay.reader.load();
  assert.equal(noPay.reader.getSnapshot().pay, null); assert.equal(noPay.reader.getSnapshot().error, null);
});

test('duplicate refreshes deduplicate; realtime during a request revalidates afterward', async () => {
  const setup = fixture(), wait = deferred(); setup.setResult(wait.promise);
  const loading = setup.reader.load();
  assert.equal(await setup.reader.load(), false);
  setup.reader.refresh(); setup.reader.refresh();
  assert.equal(setup.calls.length, 1);
  setup.setResult({ data: ready }); wait.resolve({ data: pending }); await loading; await settle();
  assert.equal(setup.calls.length, 2); assert.equal(setup.reader.getSnapshot().pay.status, 'ready');
});

test('same-user permission revocation clears saved money for RPC, JWT and HTTP denials', async () => {
  for (const denied of [
    { error: { code: 'P0001', message: 'DRIVER_PAY_PERMISSION_DENIED' } },
    { error: { code: 'DRIVER_PAY_PERMISSION_DENIED' } },
    { error: { code: '42501', message: 'permission denied' } },
    { error: { code: 'PGRST301', message: 'JWT expired' } },
    { error: { status: 401 } }, { error: { statusCode: 403 } },
    { error: { message: 'Unauthorized' }, status: 401 },
    { error: { message: 'Forbidden' }, status: 403 },
  ]) {
    const setup = fixture(); setup.setResult({ data: ready }); await setup.reader.load();
    setup.setResult(denied); assert.equal(await setup.reader.load(), false);
    assert.equal(setup.reader.getSnapshot().pay, null, JSON.stringify(denied));
    assert.equal(setup.reader.getSnapshot().error, 'load');
    assert.equal(await setup.reader.retry(), false);
  }
});

test('transport failures retain existing compensation while an access failure does not', async () => {
  const setup = fixture(); setup.setResult({ data: ready }); await setup.reader.load();
  for (const transient of [{ error: new TypeError('Failed to fetch') }, { error: { message: 'Service unavailable' }, status: 503 }]) {
    setup.setResult(transient); assert.equal(await setup.reader.load(), false);
    assert.equal(setup.reader.getSnapshot().pay.amount, 94.26);
  }
  setup.setResult({ error: { message: 'DRIVER_PAY_PERMISSION_DENIED' } }); await setup.reader.load();
  assert.equal(setup.reader.getSnapshot().pay, null);
  setup.setResult({ data: ready }); await setup.reader.load();
  assert.equal(setup.reader.getSnapshot().pay.amount, 94.26, 'Only a new authorized scoped response restores money');
});

test('retry permission denial clears frozen pay and requires a fresh scoped read before retrying', async () => {
  for (const denied of [{ error: { message: 'DRIVER_PAY_RETRY_PERMISSION_DENIED' } },
    { error: { code: 'DRIVER_PAY_RETRY_PERMISSION_DENIED' } }, { error: { message: 'Forbidden' }, status: 403 }]) {
    const setup = fixture(); setup.setResult({ data: failed }); await setup.reader.load();
    setup.setRetryResult(denied); assert.equal(await setup.reader.retry(), false);
    const operationId = setup.calls.at(-1).params.p_operation_id;
    assert.equal(setup.reader.getSnapshot().pay, null); assert.equal(setup.reader.getSnapshot().error, 'retry');
    assert.equal(await setup.reader.retry(), false);
    setup.setResult({ data: failed }); await setup.reader.load();
    setup.setRetryResult({ data: { ...pending, status: 'calculating' } }); await setup.reader.retry();
    assert.notEqual(setup.calls.at(-1).params.p_operation_id, operationId);
  }
});

test('retry sends only scope and stable operation ID, deduplicates, and uses returned atomic state', async () => {
  const setup = fixture(); setup.setResult({ data: failed }); await setup.reader.load();
  const wait = deferred(); setup.setRetryResult(wait.promise);
  const retry = setup.reader.retry(); assert.equal(await setup.reader.retry(), false);
  assert.equal(setup.calls.length, 2);
  const first = setup.calls[1]; assert.equal(first.name, 'retry_assignment_driver_pay');
  assert.deepEqual(Object.keys(first.params).sort(), [...Object.keys(args), 'p_operation_id'].sort());
  assert.match(first.params.p_operation_id, /^[0-9a-f-]{36}$/);
  wait.resolve({ error: { message: 'network failed' } }); assert.equal(await retry, false);
  assert.equal(setup.reader.getSnapshot().error, 'retry');
  setup.setRetryResult({ data: { ...pending, status: 'calculating' } }); await setup.reader.retry();
  assert.equal(setup.calls[2].params.p_operation_id, first.params.p_operation_id);
  assert.equal(setup.reader.getSnapshot().pay.status, 'calculating');
  assert.equal(setup.reader.getSnapshot().error, null);
  assert.equal(await setup.reader.retry(), false);
});

test('only server canRetry permits a retry, including elapsed retry_wait, never a ready snapshot', async () => {
  const setup = fixture(); setup.setResult({ data: { ...failed, status: 'retry_wait' } }); await setup.reader.load();
  assert.equal(setup.reader.getSnapshot().pay.canRetry, true); await setup.reader.retry();
  setup.setResult({ data: { ...failed, canRetry: false } }); await setup.reader.load();
  assert.equal(await setup.reader.retry(), false);
  setup.setResult({ data: { ...ready, canRetry: true } }); await setup.reader.load();
  assert.equal(await setup.reader.retry(), false);
});

test('closing aborts requests and prevents late data replacing a new assignment reader', async () => {
  const old = fixture(), wait = deferred(); old.setResult(wait.promise);
  const loading = old.reader.load(); old.reader.dispose();
  assert.equal(old.signals[0].aborted, true);
  const next = fixture({ scope: { assignmentId: 'assignment-b', loadId: 'load-b', driverId: 'driver-b' } });
  next.setResult({ data: ready }); await next.reader.load();
  assert.deepEqual(next.calls[0].params, { p_assignment_id: 'assignment-b', p_load_id: 'load-b', p_driver_id: 'driver-b' });
  wait.resolve({ data: pending }); assert.equal(await loading, false);
  assert.equal(old.reader.getSnapshot().pay, null); assert.equal(next.reader.getSnapshot().pay.status, 'ready');
});

test('hung reads and retries time out, clear busy, and keep the same retry operation ID', async () => {
  const setup = fixture({ timeoutMs: 5 }); setup.setResult(new Promise(() => {}));
  assert.equal(await setup.reader.load(), false);
  assert.equal(setup.signals[0].aborted, true); assert.equal(setup.reader.getSnapshot().busy, false);
  setup.setResult({ data: failed }); await setup.reader.load(); setup.setRetryResult(new Promise(() => {}));
  assert.equal(await setup.reader.retry(), false); const operationId = setup.calls.at(-1).params.p_operation_id;
  assert.equal(setup.reader.getSnapshot().busy, false); setup.setRetryResult({ data: ready }); await setup.reader.retry();
  assert.equal(setup.calls.at(-1).params.p_operation_id, operationId);
});

function observe(setup) {
  const windowTarget = new EventTarget(), documentTarget = new EventTarget();
  documentTarget.visibilityState = 'visible'; let tick, cleared = false;
  const stop = observeAssignmentDriverPay(setup.reader, setup.client, scope, { windowTarget, documentTarget,
    setIntervalFn(callback, delay) { assert.equal(delay, 30_000); tick = callback; return 1; },
    clearIntervalFn(id) { assert.equal(id, 1); cleared = true; } });
  return { windowTarget, documentTarget, tick: () => tick(), stop, get cleared() { return cleared; } };
}

test('visible polling, focus, reconnect and scoped realtime refresh; terminal cooldown still updates', async () => {
  const setup = fixture(); await setup.reader.load(); const observer = observe(setup);
  const { windowTarget, documentTarget, tick, stop } = observer;
  assert.deepEqual(setup.client.lastChannel.filter, { event: 'UPDATE', schema: 'public', table: 'assignments', filter: 'id=eq.assignment-a' });
  setup.subscribed(); await settle();
  documentTarget.visibilityState = 'hidden'; const hiddenCount = setup.calls.length;
  tick(); windowTarget.dispatchEvent(new Event('focus')); setup.changed(); await settle();
  assert.equal(setup.calls.length, hiddenCount);
  documentTarget.visibilityState = 'visible'; documentTarget.dispatchEvent(new Event('visibilitychange')); await settle();
  assert.equal(setup.calls.length, hiddenCount + 1);
  tick(); await settle(); windowTarget.dispatchEvent(new Event('online')); await settle();
  setup.setResult({ data: { ...failed, canRetry: false } }); setup.changed(); await settle();
  setup.setResult({ data: failed }); tick(); await settle(); assert.equal(setup.reader.getSnapshot().pay.canRetry, true);
  const failedCount = setup.calls.length; tick(); await settle(); assert.equal(setup.calls.length, failedCount);
  setup.setResult({ data: ready }); setup.changed(); await settle(); assert.equal(setup.reader.getSnapshot().pay.status, 'ready');
  const doneCount = setup.calls.length; tick(); await settle(); assert.equal(setup.calls.length, doneCount);
  windowTarget.dispatchEvent(new Event('focus')); await settle(); assert.equal(setup.calls.length, doneCount + 1);
  stop(); assert.equal(setup.removed, 1); assert.equal(observer.cleared, true); assert.equal(setup.authRemoved, 1);
  const stoppedCount = setup.calls.length; tick(); setup.changed(); windowTarget.dispatchEvent(new Event('focus')); await settle();
  assert.equal(setup.calls.length, stoppedCount);
});

test('sign-out or changed user clears compensation, cancels reads and removes all observers', async () => {
  for (const event of ['SIGNED_OUT', 'USER_UPDATED', 'SIGNED_IN']) {
    const setup = fixture(); setup.setResult({ data: ready }); await setup.reader.load(); const observer = observe(setup);
    setup.auth('INITIAL_SESSION', 'old-user');
    const wait = deferred(); setup.setResult(wait.promise); const loading = setup.reader.load();
    setup.auth(event, event === 'SIGNED_OUT' ? null : 'new-user');
    assert.equal(setup.reader.getSnapshot().pay, null); assert.equal(setup.removed, 1);
    assert.equal(setup.authRemoved, 1); assert.equal(observer.cleared, true);
    wait.resolve({ data: ready }); assert.equal(await loading, false); assert.equal(setup.reader.getSnapshot().pay, null);
    observer.stop();
  }
});
