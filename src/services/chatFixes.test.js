import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChatMedia, normalizeChatMedia, CHAT_MEDIA_ACCEPT } from './chatMediaPolicy.js';
import { createChatPrivacyLifecycle } from './chatPrivacyLifecycle.js';
import { chatAccountKey, ChatSessionCache, clearPersistedChatSession } from './chatSession.js';
import { readChatPreviewPages } from './chatPreviewPages.js';
import { createVoiceRecording } from './chatVoiceRecording.js';

test('MIME policy rejects picker/server mismatches before upload and normalizes recorder codecs', () => {
  for (const type of ['image/gif', 'image/heic', 'video/webm', 'text/html', 'application/x-msdownload']) {
    assert.throws(() => validateChatMedia(new File(['bytes'], 'fake.pdf', { type })), /UNSUPPORTED/);
  }
  assert.equal(validateChatMedia(new File(['pdf'], 'Receipt.PDF')), 'application/pdf');
  assert.equal(normalizeChatMedia(new File(['opus'], 'voice.webm', { type: 'audio/webm;codecs=opus' })).type, 'audio/webm');
  assert.throws(() => validateChatMedia(new File(['?'], 'unknown.webm')), /UNSUPPORTED/);
  assert.throws(() => validateChatMedia(new File([], 'empty.pdf')), /EMPTY/);
  assert.throws(() => validateChatMedia({ size: 52428801, type: 'application/pdf' }), /TOO_LARGE/);
  assert.equal(CHAT_MEDIA_ACCEPT.includes('video/*'), false);
});

test('logout clears real persisted history before unmount can write it back; token refresh preserves drafts', () => {
  const values = new Map();
  const disk = { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const user = { id: 'alice', companyId: 'one', roleCode: 'dispatcher' };
  const scope = chatAccountKey(user); const cache = new ChatSessionCache(scope, { storage: disk });
  const cleared = [];
  const lifecycle = createChatPrivacyLifecycle({ keyOf: chatAccountKey, clear: key => { cleared.push(key); clearPersistedChatSession(key, disk); } });
  const session = { user: { id: 'alice' } };
  lifecycle.update({ session, currentUser: user });
  cache.setDraft('driver', 'unsent draft'); cache.flush();
  lifecycle.update({ session, currentUser: null }); // offline profile refresh
  lifecycle.update({ session, currentUser: user });
  assert.equal(cleared.length, 0);
  lifecycle.update({ session: null, currentUser: null });
  cache.flush();
  assert.deepEqual(cleared, [scope]);
  assert.equal([...values.values()].some(value => value.includes('unsent draft')), false);
});

test('direct account and company switches retire the previous scope once', () => {
  const cleared = []; const lifecycle = createChatPrivacyLifecycle({ keyOf: chatAccountKey, clear: key => cleared.push(key) });
  const state = (id, companyId) => ({ session: { user: { id } }, currentUser: { id, companyId, roleCode: 'dispatcher' } });
  lifecycle.update(state('a', 'one')); lifecycle.update(state('a', 'two')); lifecycle.update(state('b', 'two'));
  lifecycle.update({ session: null, currentUser: null }); lifecycle.update({ session: null, currentUser: null });
  assert.equal(cleared.length, 3); assert.equal(new Set(cleared).size, 3);
});

test('preview cursor reads 1205 conversations despite a smaller server cap; partial failure is not success', async () => {
  const source = Array.from({ length: 1205 }, (_, i) => ({ id: String(i).padStart(5, '0'), last_message_at: String(i).padStart(5, '0') }));
  const result = await readChatPreviewPages(async after => source.filter(row => after == null || row.id > after).slice(0, 37));
  assert.equal(result.length, 1205); assert.equal(result[0].id, '01204');
  await assert.rejects(readChatPreviewPages(async after => { if (after) throw new Error('offline'); return source.slice(0, 100); }), /offline/);
  await assert.rejects(readChatPreviewPages(async () => source.slice(0, 1)), /CURSOR_INVALID/);
});

function recordingFixture(extra = {}) {
  let clock = 0; let tick; let released = 0; let timerCleared = 0; let limits = 0; let complete;
  const recorder = { state: 'inactive', mimeType: 'audio/mp4', start() { this.state = 'recording'; }, stop() { this.state = 'inactive'; this.onstop(); } };
  const recording = createVoiceRecording({ recorder, stream: { getTracks: () => [{ stop() { released++; } }] },
    now: () => clock, setTimer: fn => { tick = fn; return 1; }, clearTimer: () => { timerCleared++; },
    onComplete: (file, duration) => { complete = { file, duration }; }, onLimit: () => { limits++; }, ...extra });
  return { recorder, recording, advance(ms) { clock += ms; tick(); }, data(size) { recorder.ondataavailable({ data: new Blob(['x'.repeat(size)]) }); },
    get result() { return { released, timerCleared, limits, complete }; } };
}
test('voice duration limit stops tracks and sends a MIME-matching filename', async () => {
  const fixture = recordingFixture({ maxDurationMs: 2000 }); fixture.data(8); fixture.advance(2000);
  await Promise.resolve();
  assert.equal(fixture.result.limits, 1); assert.equal(fixture.recorder.state, 'inactive');
  assert.match(fixture.result.complete.file.name, /\.m4a$/); assert.equal(fixture.result.complete.duration, 2000);
  assert.ok(fixture.result.released > 0); assert.ok(fixture.result.timerCleared > 0);
});
test('voice byte ceiling rejects oversized recording rather than uploading a corrupt container; cancelling never uploads', async () => {
  const limited = recordingFixture({ maxBytes: 10 }); limited.data(7); limited.data(8);
  await Promise.resolve();
  assert.equal(limited.result.complete, undefined); assert.equal(limited.result.limits, 1);
  const cancelled = recordingFixture(); cancelled.data(5); cancelled.recording.cancel();
  assert.equal(cancelled.result.complete, undefined); assert.ok(cancelled.result.released > 0);
  cancelled.recorder.ondataavailable({ data: new Blob(['late']) });
  assert.equal(cancelled.result.complete, undefined);
});
