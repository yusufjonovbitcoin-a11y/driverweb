import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationScope, acquireCallMedia } from './chatAsyncSafety.js';
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const media = () => { let stops = 0; return { stream: { getTracks: () => [{ stop: () => { stops++; } }] }, stops: () => stops }; };
test('requests from an old conversation stay stale even after returning to that conversation', () => {
  const scope = new OperationScope();
  const old = scope.begin();
  scope.begin();
  const current = scope.begin();
  assert.equal(old(), false);
  assert.equal(current(), true);
  scope.cancel();
  assert.equal(current(), false);
});
test('media obtained after ICE lookup fails is released', async () => {
  const pending = deferred(); const tracks = media();
  await assert.rejects(acquireCallMedia(() => pending.promise, () => Promise.reject(new Error('ICE unavailable')), () => true));
  pending.resolve(tracks.stream);
  await Promise.resolve();
  assert.equal(tracks.stops(), 1);
});
test('cancelling while permission prompt is open releases tracks and rejects', async () => {
  const scope = new OperationScope(); const current = scope.begin();
  const pending = deferred(); const tracks = media();
  const result = acquireCallMedia(() => pending.promise, async () => [], current);
  scope.cancel(); pending.resolve(tracks.stream);
  await assert.rejects(result, { name: 'AbortError' });
  assert.ok(tracks.stops() >= 1);
});
test('successful acquisition retains live tracks', async () => {
  const tracks = media(); const servers = [{ urls: 'stun:example.invalid' }];
  const result = await acquireCallMedia(async () => tracks.stream, async () => servers, () => true);
  assert.deepEqual(result, [tracks.stream, servers]);
  assert.equal(tracks.stops(), 0);
});
