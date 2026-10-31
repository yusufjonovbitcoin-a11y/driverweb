import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentContentCache, documentContentSession, fetchPdfContent } from './documentContentCache.js';

test('one transfer is shared, immutable bytes survive repeated PDF.js-style transfers', async () => {
  const cache = createDocumentContentCache(); cache.setScope('actor');
  let requests = 0;
  const load = async () => { requests++; return new Blob(['%PDF-file']); };
  const [one, two] = await Promise.all([cache.load('v1', load), cache.load('v1', load)]);
  assert.equal(one, two); assert.equal(requests, 1);
  const buffer = await one.arrayBuffer(); structuredClone(buffer, { transfer: [buffer] });
  assert.equal(buffer.byteLength, 0);
  assert.equal(await (await cache.load('v1', load)).text(), '%PDF-file');
  assert.equal(requests, 1);
});

test('byte limit, LRU, expiry, and actor changes prevent unlimited/stale reuse', async () => {
  let now = 0, calls = 0;
  const cache = createDocumentContentCache({ maxBytes: 8, maxEntries: 2, ttlMs: 10, now: () => now });
  const load = async () => { calls++; return new Blob(['1234']); }; cache.setScope('a');
  await cache.load('1', load); await cache.load('2', load); await cache.load('1', load); await cache.load('3', load);
  await cache.load('2', load); assert.equal(calls, 4);
  now = 11; await cache.load('2', load); assert.equal(calls, 5);
  cache.setScope('b'); await cache.load('2', load); assert.equal(calls, 6);
  cache.setScope(null); await assert.rejects(cache.load('2', load), { name: 'AbortError' });
});

test('closing one consumer does not cancel a transfer another viewer still needs', async () => {
  const cache = createDocumentContentCache(); cache.setScope('a');
  let finish, transferSignal;
  const loader = ({ signal }) => { transferSignal = signal; return new Promise(resolve => { finish = resolve; }); };
  const controller = new AbortController();
  const closed = cache.load('v', loader, { signal: controller.signal });
  const open = cache.load('v', loader);
  await Promise.resolve(); controller.abort();
  await assert.rejects(closed, { name: 'AbortError' }); assert.equal(transferSignal.aborted, false);
  finish(new Blob(['PDF'])); assert.equal(await (await open).text(), 'PDF');
});

test('logout cancels pending content and an old source capability cannot be reused', async () => {
  let onAuth, actor = 'a';
  const client = { auth: { onAuthStateChange(callback) { onAuth = callback; }, async getSession() { return { data: { session: actor ? { user: { id: actor } } : null } }; } } };
  const session = await documentContentSession(client);
  let finish;
  const pending = session.load('v', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); actor = null; onAuth('SIGNED_OUT', null); finish(new Blob(['private']));
  await assert.rejects(pending, { name: 'AbortError' });
  actor = 'b'; onAuth('SIGNED_IN', { user: { id: actor } });
  await assert.rejects(session.load('v', async () => new Blob()), { name: 'AbortError' });
  const other = await documentContentSession(client);
  assert.equal(await (await other.load('v', async () => new Blob(['other']))).text(), 'other');
});

test('PDF transfer reports progress and rejects HTTP/invalid/oversize responses', async () => {
  const progress = [];
  const blob = await fetchPdfContent('unused', { fetcher: async () => new Response('%PDF-original', { headers: { 'Content-Length': '13' } }), onProgress: value => progress.push(value) });
  assert.equal(await blob.text(), '%PDF-original'); assert.equal(progress.at(-1).loaded, 13);
  await assert.rejects(fetchPdfContent('unused', { fetcher: async () => new Response('Expired', { status: 403 }) }), /FAILED_403/);
  await assert.rejects(fetchPdfContent('unused', { fetcher: async () => new Response('<html>') }), /INVALID_PDF/);
  await assert.rejects(fetchPdfContent('unused', { fetcher: async () => new Response('%PDF-', { headers: { 'Content-Length': String(51 * 1024 * 1024) } }) }), /TOO_LARGE/);
});

test('stalled response body times out rather than leaving the PDF loading forever', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('%PDF-')); }, cancel() { cancelled = true; } });
  await assert.rejects(fetchPdfContent('unused', { idleMs: 15, totalMs: 1000, fetcher: async () => new Response(stream) }), { name: 'TimeoutError' });
  assert.equal(cancelled, true);
});

test('failed transfers are discarded and a new attempt can succeed', async () => {
  const cache = createDocumentContentCache(); cache.setScope('a');
  await assert.rejects(cache.load('v', () => { throw Error('network'); }), /network/);
  assert.equal(await (await cache.load('v', async () => new Blob(['fresh']))).text(), 'fresh');
});

test('a lightweight JPEG preview validates its own signature, without accepting HTML or a PDF', async () => {
  const bytes = new Uint8Array([255, 216, 255, 0]);
  const blob = await fetchPdfContent('unused', { imagePreview: true, fetcher: async () => new Response(bytes) });
  assert.equal(blob.type, 'image/jpeg'); assert.equal(blob.size, 4);
  await assert.rejects(fetchPdfContent('unused', { imagePreview: true, fetcher: async () => new Response('%PDF-other') }), /INVALID_PDF/);
});
