import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfirmedLoadAssignment, assignDriverLoad, completeLoadAssignment, readConfirmedPreviewAssignment } from './loadAssignment.js';

const assignment = { id: 'assignment', load_id: 'load', driver_id: 'driver', status: 'active', driver_stage: 'accepted' };
const draft = { id: 'load', loadNumber: '#BROKER-7', internalNumber: '103', brokerLoadNumber: '#BROKER-7',
  databaseStatus: 'ready_for_offer', status: 'UNASSIGNED', driverId: null, review: { required: true, checksum: 'sha' } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('direct assignment is one atomic RPC without a blocking Edge preflight', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: assignment }; },
    functions: { invoke: () => { throw new Error('Redundant preflight'); } } };
  assert.equal(await assignDriverLoad(client, { loadId: 'load', driverId: 'driver' }), assignment);
  assert.deepEqual(calls, [['assign_load_directly', { load_id: 'load', driver_id: 'driver' }]]);
});

test('document assignment keeps checksum review and assignment in one RPC', async () => {
  const calls = [];
  await assignDriverLoad({ rpc: async (...args) => { calls.push(args); return { data: assignment }; } },
    { loadId: 'load', driverId: 'driver', checksum: 'sha' });
  assert.deepEqual(calls, [['review_and_assign_document_load', { target_load_id: 'load', target_driver_id: 'driver', source_checksum: 'sha' }]]);
  await assert.rejects(assignDriverLoad({}, { loadId: 'load', driverId: 'driver', checksum: '' }), /DOCUMENT_CHECKSUM_REQUIRED/);
});

test('a missing or mismatched acknowledgement is never shown as accepted', async () => {
  for (const data of [null, {}, { ...assignment, load_id: 'other' }, { ...assignment, driver_id: 'other' }, { ...assignment, status: 'cancelled' }]) {
    await assert.rejects(assignDriverLoad({ rpc: async () => ({ data }) }, { loadId: 'load', driverId: 'driver' }), /ASSIGN_RESULT_MISSING/);
  }
  await assert.rejects(assignDriverLoad({}, { loadId: 'load' }), /DRIVER_REQUIRED/);
});

test('server acknowledgement updates the screen without waiting for workspace refresh', async () => {
  const commit = deferred(), refresh = deferred();
  const events = [];
  const finished = completeLoadAssignment({ assign: () => commit.promise,
    confirmed: result => { assert.equal(result, assignment); events.push('confirmed'); },
    refresh: () => { events.push('refresh'); return refresh.promise; } });
  assert.deepEqual(events, []);
  commit.resolve(assignment);
  assert.equal(await finished, assignment);
  assert.deepEqual(events, ['confirmed', 'refresh']);
  refresh.resolve();
});

test('assignment failure stays retryable; post-commit refresh failure does not undo success', async () => {
  const failure = new Error('Driver is not eligible');
  let confirmed = false, refreshed = false;
  await assert.rejects(completeLoadAssignment({ assign: async () => { throw failure; },
    confirmed: () => { confirmed = true; }, refresh: () => { refreshed = true; } }), failure);
  assert.equal(confirmed, false); assert.equal(refreshed, false);
  assert.equal(await completeLoadAssignment({ assign: async () => assignment,
    confirmed: () => { confirmed = true; }, refresh: async () => { throw new Error('Offline'); } }), assignment);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(confirmed, true);
});

test('confirmed local row uses the server assignment and keeps internal/broker references separate', () => {
  const before = structuredClone(draft);
  const rows = applyConfirmedLoadAssignment([draft], draft, 'driver', assignment);
  assert.equal(rows.length, 1); assert.equal(rows[0].driverId, 'driver');
  assert.equal(rows[0].currentAssignmentId, 'assignment'); assert.equal(rows[0].status, 'ASSIGNED');
  assert.equal(rows[0].internalNumber, '103'); assert.equal(rows[0].brokerLoadNumber, '#BROKER-7');
  assert.equal(rows[0].review.required, false); assert.deepEqual(draft, before);
});

test('new PDF rows appear immediately without inventing an internal number or assignment UUID', () => {
  const preview = { loadNumber: 'BROKER-7', previewTicket: { signature: 'test' } };
  const rows = applyConfirmedLoadAssignment([], preview, 'driver', { assigned: true, loadId: 'server-load', preparedLoad: preview });
  assert.equal(rows[0].id, 'server-load'); assert.equal(rows[0].status, 'ASSIGNED');
  assert.equal(rows[0].internalNumber, null); assert.equal(rows[0].currentAssignmentId, null);
  assert.equal(rows[0].loadNumber, '#BROKER-7');
  assert.equal(rows[0].previewTicket, undefined);
});

test('a newer stage already received through Realtime is not reset to accepted', () => {
  const current = { ...draft, driverId: 'driver', currentAssignmentId: 'assignment', status: 'ON_ROAD', databaseStatus: 'in_progress' };
  const loads = [current];
  assert.equal(applyConfirmedLoadAssignment(loads, draft, 'driver', assignment), loads);
  assert.throws(() => applyConfirmedLoadAssignment(loads, { ...draft, id: 'other' }, 'driver', assignment), /ASSIGN_RESULT_MISSING/);
});

function reconciliationClient(overrides = {}) {
  const queries = [], sessions = overrides.sessions || ['actor', 'actor']; let reads = 0;
  const rows = { manual_load_imports: { load_id: 'load', status: 'extracted' },
    loads: { id: 'load', status: 'assigned', current_assignment_id: 'assignment' },
    assignments: assignment, ...overrides.rows };
  return { queries, auth: { getSession: async () => ({ data: { session: { user: { id: sessions[reads++] } } } }) },
    from(table) { const query = { table, filters: [] }; queries.push(query);
      return { select() { return this; }, eq(key, value) { query.filters.push([key, value]); return this; },
        maybeSingle: async () => ({ data: rows[table], error: overrides.error ? Error('Denied') : null }) };
    } };
}
const source = { actorId: 'actor', checksum: 'sha', driverId: 'driver' };
test('lost response reconciles exact creator/checksum/current assignment under the same account', async () => {
  const client = reconciliationClient();
  assert.deepEqual(await readConfirmedPreviewAssignment(client, source), { assigned: true, loadId: 'load' });
  assert.deepEqual(client.queries[0].filters, [['created_by', 'actor'], ['checksum_sha256', 'sha']]);
  assert.deepEqual(client.queries[2].filters, [['id', 'assignment'], ['load_id', 'load'], ['driver_id', 'driver'], ['status', 'active']]);
});
test('pending import, a different driver, replaced assignment and denied reads cannot manufacture success', async () => {
  for (const overrides of [
    { rows: { manual_load_imports: { load_id: 'load', status: 'processing' } } },
    { rows: { loads: { id: 'load', status: 'draft' } } },
    { rows: { assignments: { ...assignment, driver_id: 'other' } } },
    { rows: { assignments: { ...assignment, id: 'old-assignment' } } },
    { rows: { assignments: { ...assignment, status: 'reassigned' } } },
    { error: true }, { sessions: ['other'] }, { sessions: ['actor', 'other'] },
  ]) assert.equal(await readConfirmedPreviewAssignment(reconciliationClient(overrides), source), null);
});
test('missing reconciliation scope performs no reads', async () => {
  const client = reconciliationClient();
  assert.equal(await readConfirmedPreviewAssignment(client, { ...source, checksum: null }), null);
  assert.deepEqual(client.queries, []);
});
