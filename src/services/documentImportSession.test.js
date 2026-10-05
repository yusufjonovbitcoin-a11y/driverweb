import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentImportRunner, mergeDocumentImportResult, continueDocumentImport, shouldCancelImportOnNavigation, findExistingFinalizedLoad } from './documentImportSession.js';

const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const context = () => ({ source: 'document', importRequestId: 'first', fileName: 'load.pdf',
  sourceUrl: 'blob:preview', preferredDriverId: null, awaitingDriverSelection: true });
const drivers = [{ id: 'driver-a' }, { id: 'driver-b' }];

test('an already assigned load number is detected without treating a review draft as finalized', () => {
  const loads = [
    { id: 'draft', loadNumber: '#25008654', databaseStatus: 'review' },
    { id: 'assigned', loadNumber: '#25008654', databaseStatus: 'assigned' },
  ];
  assert.equal(findExistingFinalizedLoad(loads, '25008654')?.id, 'assigned');
  assert.equal(findExistingFinalizedLoad(loads, '#999'), null);
  assert.equal(findExistingFinalizedLoad(loads, ''), null);
});

test('browser tab navigation cancels imports but broker navigation to its own import page does not', () => {
  assert.equal(shouldCancelImportOnNavigation('kanban', 'chat'), true);
  assert.equal(shouldCancelImportOnNavigation('drivers', 'kanban'), true);
  assert.equal(shouldCancelImportOnNavigation('drivers', 'drivers'), false);
  assert.equal(shouldCancelImportOnNavigation('kanban', 'kanban'), false);
  assert.equal(shouldCancelImportOnNavigation(null, 'chat'), false);
});

test('analysis starts before driver selection, result keeps selected driver without a second request', async () => {
  const runner = createDocumentImportRunner();
  const request = pending();
  let state = context(), calls = 0, finishes = 0;
  const task = runner.run({
    prepare: () => { calls++; return request.promise; },
    onResult: result => { state = mergeDocumentImportResult(state, 'first', result); },
    onError: () => assert.fail('should succeed'),
    onFinish: () => { finishes++; },
  });
  assert.equal(calls, 1);
  assert.equal(state.preferredDriverId, null);
  assert.equal(runner.busy, true);
  state = continueDocumentImport({ ...state, preferredDriverId: 'driver-b' }, drivers);
  assert.equal(state.awaitingDriverSelection, false, 'opens result/loading page on driver choice');
  request.resolve({ preparedLoad: { previewTicket: 'ticket', rate: 2000, preferredDriverId: 'untrusted' } });
  await task;
  assert.equal(calls, 1);
  assert.equal(state.preferredDriverId, 'driver-b');
  assert.equal(state.awaitingDriverSelection, false);
  assert.equal(state.previewTicket, 'ticket');
  assert.equal(state.sourceUrl, 'blob:preview');
  assert.equal(finishes, 1);
  assert.equal(runner.busy, false);
});

test('AI finishing first does not bypass driver choice; choosing then opens prepared result', async () => {
  let state = mergeDocumentImportResult(context(), 'first', { preparedLoad: { rate: 1050 } });
  assert.equal(state.awaitingDriverSelection, true);
  state = continueDocumentImport({ ...state, preferredDriverId: 'driver-a' }, drivers);
  assert.equal(state.awaitingDriverSelection, false);
  assert.equal(state.rate, 1050);
});

test('missing, removed driver, analysis error, and saved-load flow cannot continue as a document', () => {
  for (const state of [context(), { ...context(), preferredDriverId: 'removed' },
    { ...context(), preferredDriverId: 'driver-a', importError: 'failed' },
    { ...context(), source: 'saved', preferredDriverId: 'driver-a' }]) {
    assert.equal(continueDocumentImport(state, drivers), state);
  }
  assert.equal(continueDocumentImport(null, drivers), null);
});

test('rapid duplicate drops do not start a second analysis', async () => {
  const runner = createDocumentImportRunner();
  const request = pending();
  let calls = 0;
  const options = { prepare: () => { calls++; return request.promise; }, onResult() {}, onError() {}, onFinish() {} };
  const task = runner.run(options);
  assert.equal(await runner.run(options), false);
  assert.equal(calls, 1);
  request.resolve({});
  await task;
});

test('cancel/navigation detaches old response; a newer import remains busy and unchanged', async () => {
  const runner = createDocumentImportRunner();
  const oldRequest = pending(), newRequest = pending();
  const events = [];
  const run = (request, name) => runner.run({ prepare: () => request.promise,
    onResult: () => events.push(`${name}:result`), onError: () => events.push(`${name}:error`),
    onFinish: () => events.push(`${name}:finish`) });
  const oldTask = run(oldRequest, 'old');
  runner.cancel();
  const newTask = run(newRequest, 'new');
  oldRequest.resolve({});
  await oldTask;
  assert.deepEqual(events, []);
  assert.equal(runner.busy, true);
  newRequest.resolve({});
  await newTask;
  assert.deepEqual(events, ['new:result', 'new:finish']);
  assert.equal(runner.busy, false);
});

test('cancelled failures are ignored and failed active requests can be retried', async () => {
  const runner = createDocumentImportRunner();
  const request = pending();
  let errors = 0, finishes = 0;
  const callbacks = { onResult() {}, onError: () => { errors++; }, onFinish: () => { finishes++; } };
  const task = runner.run({ ...callbacks, prepare: () => request.promise });
  runner.cancel();
  request.reject(new Error('late failure'));
  await task;
  assert.equal(errors, 0);
  assert.equal(finishes, 0);
  await runner.run({ ...callbacks, prepare: () => { throw new Error('retryable'); } });
  assert.equal(errors, 1);
  assert.equal(finishes, 1);
  assert.equal(runner.busy, false);
  await runner.run({ ...callbacks, prepare: async () => ({}) });
  assert.equal(finishes, 2);
});

test('merge ignores stale request and retains existing broker source metadata', () => {
  const current = { ...context(), sourceKind: 'broker', brokerMessageId: 'message', brokerAttachmentId: 'attachment', preferredDriverId: 'driver-a', awaitingDriverSelection: false };
  assert.equal(mergeDocumentImportResult(current, 'other', {}), current);
  assert.equal(mergeDocumentImportResult(null, 'first', {}), null);
  const merged = mergeDocumentImportResult(current, 'first', { preparedLoad: { id: 'load' }, sourceUrl: 'https://example.test/pdf' });
  assert.equal(merged.brokerAttachmentId, 'attachment');
  assert.equal(merged.brokerMessageId, 'message');
  assert.equal(merged.sourceKind, 'broker');
  assert.equal(merged.sourceUrl, 'https://example.test/pdf');
  assert.equal(merged.preferredDriverId, 'driver-a');
});
