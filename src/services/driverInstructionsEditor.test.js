import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverInstructionsEditor } from './driverInstructionsEditor.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  let row = { driver_instructions: 'Original', version: 1 };
  let readResult;
  let writeResult;
  const reads = [], writes = [], signals = [];
  const client = {
    from(table) {
      assert.equal(table, 'loads');
      return { select(fields) { assert.equal(fields, 'driver_instructions,version'); return this; },
        eq(field, id) { assert.equal(field, 'id'); reads.push(id); return this; }, single() { return this; },
        abortSignal(signal) { signals.push(signal); return readResult || Promise.resolve({ data: { ...row } }); } };
    },
    rpc(name, params) {
      assert.equal(name, 'save_driver_instructions'); writes.push(params);
      return { abortSignal(signal) {
        signals.push(signal);
        if (writeResult) return writeResult;
        if (params.expected_version !== row.version) return Promise.resolve({ error: { message: 'Load changed; refresh before retrying' } });
        row = { version: row.version + 1, driver_instructions: params.instructions.trim() || null };
        return Promise.resolve({ data: { ...row } });
      } };
    },
  };
  return { editor: createDriverInstructionsEditor({ loadId: 'load-a', getClient: () => client }), reads, writes, signals,
    remote(next) { row = next; }, deferRead(value) { readResult = value; }, deferWrite(value) { writeResult = value; } };
}

test('instructions load lazily and save canonical text with the exact load version', async () => {
  const { editor, reads, writes } = fixture();
  assert.equal(editor.getSnapshot().draft, null); assert.equal(reads.length, 0);
  assert.equal(await editor.save(), false);
  await editor.load(); editor.setDraft('  Call before arrival  ');
  assert.equal(await editor.save(), true);
  assert.deepEqual(writes, [{ target_load_id: 'load-a', expected_version: 1, instructions: '  Call before arrival  ' }]);
  assert.equal(editor.getSnapshot().draft, 'Call before arrival');
  assert.equal(editor.getSnapshot().version, 2); assert.equal(editor.getSnapshot().saved, true);
});

test('version conflict retains draft and requires refreshed data plus explicit reviewed retry', async () => {
  const { editor, remote, writes } = fixture();
  await editor.load(); editor.setDraft('My unsaved instructions');
  remote({ driver_instructions: 'Concurrent dispatcher instructions', version: 2 });
  assert.equal(await editor.save(), false);
  assert.equal(editor.getSnapshot().error, 'conflict');
  assert.equal(await editor.save(), false); assert.equal(writes.length, 1);
  await editor.load();
  assert.equal(editor.getSnapshot().draft, 'My unsaved instructions');
  assert.equal(editor.getSnapshot().remoteText, 'Concurrent dispatcher instructions');
  assert.equal(editor.getSnapshot().requiresReview, true);
  assert.equal(await editor.save(), false); assert.equal(writes.length, 1);
  editor.setReviewed(true); assert.equal(await editor.save(), true);
  assert.equal(writes[1].expected_version, 2);
  assert.equal(editor.getSnapshot().remoteText, null);
});

test('another change after reviewing is rejected again instead of overwriting it', async () => {
  const { editor, remote } = fixture();
  await editor.load(); editor.setDraft('Mine');
  remote({ driver_instructions: 'Other', version: 2 });
  await editor.load(); editor.setReviewed(true);
  remote({ driver_instructions: 'Newer', version: 3 });
  assert.equal(await editor.save(), false);
  assert.equal(editor.getSnapshot().draft, 'Mine');
  await editor.load(); assert.equal(editor.getSnapshot().reviewed, false);
  assert.equal(await editor.save(), false);
});

test('double submission and refresh during a write produce only one request', async () => {
  const { editor, deferWrite, writes, reads } = fixture();
  await editor.load(); editor.setDraft('Draft');
  const pending = deferred(); deferWrite(pending.promise);
  const first = editor.save();
  assert.equal(await editor.save(), false); assert.equal(await editor.load(), false);
  editor.setDraft('Not accepted during save');
  assert.equal(writes.length, 1); assert.equal(reads.length, 1);
  pending.resolve({ data: { version: 2, driver_instructions: 'Draft' } });
  await first; assert.equal(editor.getSnapshot().draft, 'Draft');
});

test('closing cancels pending work and late old responses cannot overwrite reopened state', async () => {
  const { editor, deferRead, signals } = fixture();
  const old = deferred(); deferRead(old.promise);
  const first = editor.load(); editor.dispose();
  assert.equal(signals[0].aborted, true);
  deferRead(Promise.resolve({ data: { version: 9, driver_instructions: 'Reopened' } }));
  await editor.load(); old.resolve({ data: { version: 1, driver_instructions: 'Stale' } });
  assert.equal(await first, false);
  assert.equal(editor.getSnapshot().draft, 'Reopened'); assert.equal(editor.getSnapshot().busy, false);
});

test('request errors are retryable and empty instructions are a valid deliberate save', async () => {
  const { editor, deferRead } = fixture();
  deferRead(Promise.resolve({ error: new Error('Offline') })); await editor.load();
  assert.equal(editor.getSnapshot().error, 'request');
  deferRead(null); await editor.load(); editor.setDraft('');
  assert.equal(await editor.save(), true); assert.equal(editor.getSnapshot().draft, '');
});
