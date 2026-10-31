import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundAssignmentKey, createBackgroundAssignments } from './backgroundAssignments.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const options = (work, confirmed = () => {}) => ({ key: 'checksum', label: '#TEST', driverName: 'Test Driver',
  input: { file: { name: 'test.pdf' }, ticket: 'private-signed-ticket', driverId: 'driver-one' },
  perform: work, confirmed, formatError: error => error.message });

test('submission returns immediately while actual assignment remains pending; captured file/driver survive page changes', async () => {
  const queue = createBackgroundAssignments(), response = deferred();
  let accepted = false, input;
  const task = options(value => { input = value; return response.promise; }, () => { accepted = true; });
  assert.equal(queue.start(task), true);
  assert.equal(queue.getSnapshot()[0].status, 'pending');
  assert.equal(accepted, false);
  assert.equal(JSON.stringify(queue.getSnapshot()).includes('private-signed-ticket'), false);
  await flush(); assert.equal(input, task.input);
  response.resolve({ assigned: true }); await flush();
  assert.equal(accepted, true); assert.deepEqual(queue.getSnapshot(), []);
});

test('double-click, alternate driver and pending retry cannot dispatch the same source twice', async () => {
  const queue = createBackgroundAssignments(), response = deferred(); let calls = 0;
  const task = options(() => { calls++; return response.promise; });
  queue.start(task);
  assert.equal(queue.start({ ...task, input: { driverId: 'different-driver' } }), false);
  assert.equal(queue.retry(task.key), false);
  assert.equal(queue.takeForReview(task.key), null);
  queue.dismiss(task.key); assert.equal(queue.getSnapshot().length, 1);
  await flush(); assert.equal(calls, 1);
  response.resolve({}); await flush();
});

test('failure retains original file for one retry and never announces acceptance early', async () => {
  const queue = createBackgroundAssignments(); let calls = 0, accepted = 0;
  const task = options(async input => {
    assert.equal(input.driverId, 'driver-one');
    if (++calls === 1) throw Error('Connection lost');
    return { assigned: true };
  }, () => { accepted++; });
  queue.start(task); await flush();
  assert.equal(queue.getSnapshot()[0].status, 'failed'); assert.equal(accepted, 0);
  assert.equal(queue.getSnapshot()[0].error, 'Connection lost');
  assert.equal(queue.retry(task.key), true); assert.equal(queue.retry(task.key), false);
  await flush(); assert.equal(calls, 2); assert.equal(accepted, 1);
});

test('failure can return to review with original input; dismiss releases only failed work', async () => {
  const queue = createBackgroundAssignments(), task = options(async () => { throw Error('Rejected'); });
  queue.start(task); await flush();
  assert.equal(queue.takeForReview(task.key), task.input); assert.deepEqual(queue.getSnapshot(), []);
  queue.start(task); await flush(); queue.dismiss(task.key); assert.deepEqual(queue.getSnapshot(), []);
});

test('account reset fences late results and does not overwrite a newer task with the same key', async () => {
  const queue = createBackgroundAssignments(), old = deferred(), next = deferred(); let oldAccepted = false, newAccepted = false;
  queue.start(options(() => old.promise, () => { oldAccepted = true; })); await flush(); queue.clear();
  queue.start(options(() => next.promise, () => { newAccepted = true; })); await flush();
  old.resolve({}); await flush();
  assert.equal(oldAccepted, false); assert.equal(queue.getSnapshot()[0].status, 'pending');
  next.resolve({}); await flush(); assert.equal(newAccepted, true); assert.deepEqual(queue.getSnapshot(), []);
});

test('cleanup before work starts prevents submission; presentation failure after commit cannot trigger retry', async () => {
  const queue = createBackgroundAssignments(); let calls = 0;
  queue.start(options(async () => { calls++; })); queue.clear(); await flush(); assert.equal(calls, 0);
  queue.start(options(async () => { calls++; }, () => { throw Error('View unmounted'); })); await flush();
  assert.equal(calls, 1); assert.deepEqual(queue.getSnapshot(), []); assert.equal(queue.retry('checksum'), false);
});

test('snapshots are stable between changes, private input stays private and unsubscribe works', async () => {
  const queue = createBackgroundAssignments(), response = deferred(); let changes = 0;
  const unsubscribe = queue.subscribe(() => { changes++; });
  assert.equal(queue.getSnapshot(), queue.getSnapshot()); queue.start(options(() => response.promise));
  const snapshot = queue.getSnapshot(); assert.equal(snapshot, queue.getSnapshot()); assert.equal(snapshot[0].input, undefined);
  unsubscribe(); response.resolve({}); await flush(); assert.equal(changes, 1);
  assert.equal(backgroundAssignmentKey({ id: 'id', review: { checksum: 'sha' } }), 'sha');
});

test('account-scoped queue rejects another account before any I/O', async () => {
  const queue = createBackgroundAssignments('actor'); let sent = false;
  assert.equal(queue.start(options(async () => { sent = true; })), false);
  await flush(); assert.equal(sent, false); assert.deepEqual(queue.getSnapshot(), []);
});
