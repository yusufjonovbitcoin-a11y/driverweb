import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTrashMetadata, partitionTrashedLoads, runLoadTrashAction } from './loadTrashActions.js';

const load = { id: 'test-load', version: 4 };
test('trash actions send the reviewed version and explicit restore driver', async () => {
  const calls = [];
  const client = { functions: { invoke: async () => ({ data: { fixedPay: false } }) },
    rpc: async (...args) => { calls.push(args); return { data: load }; } };
  await runLoadTrashAction(client, 'trash', load);
  await assert.rejects(runLoadTrashAction(client, 'restore', load), /DRIVER_REQUIRED/);
  await runLoadTrashAction(client, 'restore', load, 'other-driver');
  await runLoadTrashAction(client, 'delete', load);
  assert.deepEqual(calls, [
    ['trash_load', { target_load_id: load.id, expected_version: 4 }],
    ['restore_trashed_load', { target_load_id: load.id, expected_version: 4, target_driver_id: 'other-driver' }],
    ['permanently_delete_trashed_load', { target_load_id: load.id, expected_version: 4 }],
  ]);
});
test('stale/missing versions and unknown actions never send a request', async () => {
  const client = { rpc: () => { throw new Error('unexpected request'); } };
  for (const version of [undefined, null, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(runLoadTrashAction(client, 'trash', { ...load, version }), /LOAD_TRASH_CONFLICT/);
  }
  await assert.rejects(runLoadTrashAction(client, 'unknown', load), /LOAD_TRASH_CONFLICT/);
});
test('server errors are not retried or treated as success', async () => {
  let calls = 0;
  const error = new Error('LOAD_TRASH_CONFLICT');
  await assert.rejects(runLoadTrashAction({ rpc: async () => { calls++; return { error }; } }, 'trash', load), error);
  assert.equal(calls, 1);
  await assert.rejects(runLoadTrashAction({ rpc: async () => ({ data: null }) }, 'trash', load), /EMPTY_RESULT/);
});
test('trash is separate from ordinary cancelled/completed history and preserves original objects', () => {
  const active = { id: 'active' };
  const cancelled = { id: 'cancelled', databaseStatus: 'cancelled' };
  const trash = { id: 'trash', ...loadTrashMetadata({ trashed_at: '2026-10-06', trash_previous_driver_id: 'driver', trash_previous_status: 'delivered' }), documents: { rateCon: 'preserved' } };
  assert.deepEqual(partitionTrashedLoads([active, cancelled, trash]), { active: [active, cancelled], trash: [trash] });
  assert.equal(trash.trashedDriverId, 'driver');
  assert.equal(trash.documents.rateCon, 'preserved');
});
