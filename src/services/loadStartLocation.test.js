import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLoadStartLocation } from './loadStartLocation.js';

const scope = { loadId: 'load', assignmentId: 'assignment', driverId: 'driver' };
const captured = '2026-10-26T10:00:00.000Z';
const received = '2026-10-26T10:01:00.123456Z';
const operation = { operation_id: 'start', load_id: 'load', actor_id: 'driver', occurred_at: captured,
  received_at: received, result: { assignmentId: 'assignment', loadId: 'load' } };
const point = { latitude: '40.5', longitude: '-74.2', captured_at: captured };
function fixture(op = operation, points = [point], error = null) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    return { select(value) { call.select = value; return this; },
      eq(...args) { call.filters.push(args); return this; },
      order(...args) { call.order = args; return this; }, limit(value) { call.limit = value; return this; },
      maybeSingle() { return this; },
      abortSignal(signal) { call.signal = signal; return Promise.resolve({ data: table === 'client_operations' ? op : points, error }); } };
  } };
  return { client, calls };
}

test('START reads only accepted evidence for this exact assignment, including offline capture/receipt times', async () => {
  const { client, calls } = fixture();
  const signal = new AbortController().signal;
  assert.deepEqual(await fetchLoadStartLocation(client, scope, signal), { status: 'ready', location: {
    lat: 40.5, lng: -74.2, observedAt: Date.parse(captured), capturedAt: captured,
  } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.signal === signal));
  for (const filter of [['load_id', 'load'], ['actor_id', 'driver'], ['command_type', 'advance_driver_stage'],
    ['status', 'accepted'], ['payload->>nextStage', 'en_route_to_pickup'], ['result->>assignmentId', 'assignment']]) {
    assert.ok(calls[0].filters.some(item => JSON.stringify(item) === JSON.stringify(filter)));
  }
  assert.deepEqual(calls[1].filters, [['load_id', 'load'], ['driver_id', 'driver'],
    ['event_type', 'driver.en_route_to_pickup'], ['captured_at', captured], ['created_at', received]]);
});

test('before START, no historic tracking point or current presence is substituted', async () => {
  const { client, calls } = fixture(null);
  assert.equal((await fetchLoadStartLocation(client, scope)).status, 'awaiting_start');
  assert.equal(calls.length, 1);
  assert.equal((await fetchLoadStartLocation(client, { ...scope, assignmentId: null })).status, 'awaiting_start');
  assert.equal(calls.length, 1);
});

test('missing, ambiguous, invalid or differently timed START GPS stays unknown', async () => {
  for (const points of [[], [point, point], [{ ...point, latitude: null }], [{ ...point, longitude: ' ' }],
    [{ ...point, latitude: 91 }], [{ ...point, longitude: Infinity }], [{ ...point, captured_at: received }]]) {
    assert.deepEqual(await fetchLoadStartLocation(fixture(operation, points).client, scope), { status: 'missing_location', location: null });
  }
  const result = await fetchLoadStartLocation(fixture(operation, [{ ...point, latitude: 0, longitude: 0 }]).client, scope);
  assert.equal(result.location.lat, 0); assert.equal(result.location.lng, 0);
});

test('another assignment, driver or load is rejected rather than reusing an old START', async () => {
  for (const op of [{ ...operation, actor_id: 'other' }, { ...operation, load_id: 'other' },
    { ...operation, result: { ...operation.result, assignmentId: 'previous-assignment' } },
    { ...operation, result: { ...operation.result, loadId: 'other' } }, { ...operation, received_at: null }]) {
    await assert.rejects(fetchLoadStartLocation(fixture(op).client, scope), /LOAD_START_SCOPE_MISMATCH/);
  }
});

test('permission and network errors propagate without a presence fallback', async () => {
  const error = new Error('permission denied');
  error.code = '42501';
  await assert.rejects(fetchLoadStartLocation(fixture(operation, [point], error).client, scope), error);
});
