import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedSignedMediaUrl, createMediaUrlCache, invalidateSignedMediaUrl } from './mediaUrlCache.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('concurrent signed URL lookups share one request until its TTL expires', async () => {
  let clock = 0;
  let requests = 0;
  const pending = deferred();
  const cache = createMediaUrlCache({ ttlMs: 100, now: () => clock });
  cache.setScope('admin-a');
  const sign = () => { requests += 1; return pending.promise; };
  const first = cache.load('document-a', sign);
  const second = cache.load('document-a', sign);
  assert.equal(first, second);
  pending.resolve('signed-a');
  assert.equal(await first, 'signed-a');
  assert.equal(requests, 1);
  clock = 99;
  assert.equal(await cache.load('document-a', sign), 'signed-a');
  assert.equal(requests, 1);
  clock = 100;
  await cache.load('document-a', sign);
  assert.equal(requests, 2);
});

test('failed and empty signatures are retried instead of retained', async () => {
  const cache = createMediaUrlCache();
  cache.setScope('admin-a');
  await assert.rejects(cache.load('document-a', () => Promise.reject(new Error('Offline'))), /Offline/);
  assert.equal(await cache.load('document-a', () => null), null);
  assert.equal(await cache.load('document-a', () => 'recovered'), 'recovered');
});

test('logout or changing users rejects a pending result and drops previous URLs', async () => {
  const cache = createMediaUrlCache();
  cache.setScope('admin-a');
  await cache.load('cached', () => 'private-a');
  const pending = deferred();
  const request = cache.load('pending', () => pending.promise);
  await Promise.resolve();
  cache.setScope(null);
  pending.resolve('private-a');
  await assert.rejects(request, { name: 'AbortError' });
  await assert.rejects(cache.load('cached', () => 'should-not-run'), { name: 'AbortError' });
  cache.setScope('admin-b');
  assert.equal(await cache.load('cached', () => 'private-b'), 'private-b');
});

test('cache is bounded and an invalidated older promise cannot replace a new entry', async () => {
  const cache = createMediaUrlCache({ maxEntries: 2 });
  cache.setScope('admin-a');
  await cache.load('one', () => 'one');
  await cache.load('two', () => 'two');
  await cache.load('three', () => 'three');
  assert.equal(await cache.load('one', () => 'new-one'), 'new-one');
  const pending = deferred();
  const old = cache.load('two', () => pending.promise);
  cache.delete('two');
  assert.equal(await cache.load('two', () => 'replacement'), 'replacement');
  pending.resolve(null);
  await old;
  assert.equal(await cache.load('two', () => 'unexpected'), 'replacement');
});

function authClient(actor = 'admin-a') {
  let callback;
  const client = { auth: {
    async getSession() { return { data: { session: actor ? { user: { id: actor } } : null } }; },
    onAuthStateChange(listener) { callback = listener; },
  } };
  return {
    client,
    event(type, nextActor) {
      actor = nextActor;
      callback(type, actor ? { user: { id: actor } } : null);
    },
  };
}

test('authenticated cache clears on sign-out and profile change; token refresh keeps URLs', async () => {
  const auth = authClient();
  let requests = 0;
  const sign = () => `url-${++requests}`;
  assert.equal(await cachedSignedMediaUrl(auth.client, 'file', sign), 'url-1');
  auth.event('TOKEN_REFRESHED', 'admin-a');
  assert.equal(await cachedSignedMediaUrl(auth.client, 'file', sign), 'url-1');
  auth.event('USER_UPDATED', 'admin-a');
  assert.equal(await cachedSignedMediaUrl(auth.client, 'file', sign), 'url-2');
  auth.event('SIGNED_OUT', null);
  await assert.rejects(cachedSignedMediaUrl(auth.client, 'file', sign), { name: 'AbortError' });
  auth.event('SIGNED_IN', 'admin-b');
  assert.equal(await cachedSignedMediaUrl(auth.client, 'file', sign), 'url-3');
  invalidateSignedMediaUrl(auth.client, 'file');
  assert.equal(await cachedSignedMediaUrl(auth.client, 'file', sign), 'url-4');
});

test('a session lookup arriving after account switch cannot restore the old actor', async () => {
  const auth = authClient();
  await cachedSignedMediaUrl(auth.client, 'file', () => 'private-a');
  const session = deferred();
  auth.client.auth.getSession = () => session.promise;
  const request = cachedSignedMediaUrl(auth.client, 'file', () => 'private-a');
  auth.event('SIGNED_IN', 'admin-b');
  session.resolve({ data: { session: { user: { id: 'admin-a' } } } });
  await assert.rejects(request, { name: 'AbortError' });
});
