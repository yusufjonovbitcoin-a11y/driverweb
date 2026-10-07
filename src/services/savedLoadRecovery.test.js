import test from 'node:test';
import assert from 'node:assert/strict';
import { approveSavedLoadDraft, recoverableLoads, recoverSavedLoad } from './savedLoadRecovery.js';

import { loadBoardStatus } from './loadBoardStatus.js';
import { loadTrashMetadata, partitionTrashedLoads } from './loadTrashActions.js';

const draft = { id: 'durable-load', databaseStatus: 'draft' };
function actions(fail) {
  const calls = [];
  const make = name => async (...args) => { calls.push([name, ...args]); if (name === fail) throw new Error('temporary failure'); return 'saved-assignment'; };
  return { calls, approve: make('approve'), assign: make('assign'), review: make('review') };
}
test('all durable undispatched states remain recoverable, including failed creation and existing offers', () => {
  const loads = ['draft','review','ready_for_offer','offered','assigned','completed','cancelled'].map((databaseStatus,id) => ({ id: String(id), databaseStatus }));
  assert.deepEqual(recoverableLoads([...loads,{ ...draft, trashedAt: 'yesterday' }]).map(load=>load.databaseStatus), ['draft','review','ready_for_offer','offered']);
});
test('approval failure never assigns or creates another load; an explicit retry resumes the same ID', async () => {
  const failed = actions('approve');
  await assert.rejects(recoverSavedLoad(draft, 'driver', failed), /temporary/);
  assert.deepEqual(failed.calls, [['approve','durable-load']]);
  const retry = actions();
  assert.equal(await recoverSavedLoad(draft, 'driver', retry), 'saved-assignment');
  assert.deepEqual(retry.calls,[['approve','durable-load'],['assign','durable-load','driver']]);
});
test('a saved assignment failure retries the refreshed ready load without another approval', async () => {
  const failed = actions('assign');
  await assert.rejects(recoverSavedLoad(draft, 'driver', failed), /temporary/);
  const retry = actions();
  await recoverSavedLoad({ ...draft, databaseStatus:'ready_for_offer' }, 'another-driver', retry);
  assert.deepEqual(retry.calls,[['assign','durable-load','another-driver']]);
});
test('extracted drafts retain atomic review/checksum validation rather than generic approval', async () => {
  const api = actions();
  await recoverSavedLoad({ ...draft, review:{ required:true, checksum:'source-checksum' } }, 'driver', api);
  assert.deepEqual(api.calls,[['review','durable-load','driver','source-checksum']]);
});
test('missing driver, trash or finalized load never starts recovery mutations', async () => {
  const api = actions();
  await assert.rejects(recoverSavedLoad(draft, null, api), /DRIVER_REQUIRED/);
  for (const load of [{...draft,trashedAt:'yesterday'},{...draft,databaseStatus:'assigned'},{...draft,databaseStatus:'completed'}]) await assert.rejects(recoverSavedLoad(load,'driver',api), /UNAVAILABLE/);
  assert.deepEqual(api.calls,[]);
});

test('approval-response loss resumes durable ready state without repeating a non-idempotent approval', async () => {
  const calls = [];
  let status = 'draft';
  const client = { from(table) { assert.equal(table,'loads'); return { select(){return this}, eq(key,value){assert.equal(key,'id');assert.equal(value,draft.id);return this}, maybeSingle:async()=>({data:{status}}) }; },
    rpc:async(name,args)=>{ calls.push([name,args]); status='ready_for_offer'; return {error:new Error('response lost')}; } };
  await assert.rejects(approveSavedLoadDraft(client,draft.id), /response lost/);
  await approveSavedLoadDraft(client,draft.id);
  assert.deepEqual(calls,[['approve_load_draft',{load_id:draft.id}]]);
});
test('failed authoritative read does not mutate a draft on an uncertain connection', async () => {
  const client = { from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({error:new Error('offline')})}),rpc:()=>assert.fail('no mutation') };
  await assert.rejects(approveSavedLoadDraft(client,draft.id), /offline/);
});


test('a legacy unassigned restore leaves trash and stays reachable through saved-load recovery', async () => {
  const trashed = { ...draft, status: 'COMPLETED', trashedAt: '2026-10-07', version: 4 };
  assert.deepEqual(partitionTrashedLoads([trashed]).trash, [trashed]);
  assert.deepEqual(recoverableLoads([trashed]), []);
  // Existing rows restored by older clients may have no assignment. The same
  // normalized row used by workspace reads and restore reconciliation remains
  // recoverable even though the dispatched-only board deliberately omits it.
  const row = { id: draft.id, status: 'ready_for_offer', version: 5, trashed_at: null, current_assignment_id: null };
  const restored = { ...trashed, ...loadTrashMetadata(row), version: row.version,
    databaseStatus: row.status, status: loadBoardStatus(row), driverId: null };
  const partition = partitionTrashedLoads([restored]);
  assert.deepEqual(partition.trash, []);
  assert.equal(restored.status, 'UNASSIGNED');
  assert.deepEqual(recoverableLoads(partition.active), [restored]);
  const retry = actions();
  await recoverSavedLoad(restored, 'chosen-driver', retry);
  assert.deepEqual(retry.calls, [['assign', draft.id, 'chosen-driver']]);
});
