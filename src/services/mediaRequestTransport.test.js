import assert from 'node:assert/strict';
import test from 'node:test';
import { requestMediaJson, uploadMediaRequest } from './mediaRequestTransport.js';

function fakeXhr() {
  return { upload: {}, open() {}, setRequestHeader() {}, send() { this.sent = true; }, abort() { this.onabort?.(); } };
}

test('already cancelled uploads never send a request', async () => {
  const controller = new AbortController();
  controller.abort();
  let created = false;
  await assert.rejects(uploadMediaRequest({ signal: controller.signal, xhrFactory() { created = true; } }), { name: 'AbortError' });
  assert.equal(created, false);
});

test('uploads have a deadline and cancellation rejects exactly once', async () => {
  const xhr = fakeXhr();
  const controller = new AbortController();
  const result = uploadMediaRequest({ url: '/media', headers: {}, body: 'data', signal: controller.signal, xhrFactory: () => xhr });
  assert.equal(xhr.timeout, 120_000);
  assert.equal(xhr.sent, true);
  controller.abort();
  xhr.ontimeout();
  await assert.rejects(result, { name: 'AbortError' });
});

test('upload timeout and malformed success cannot report success', async () => {
  const xhr = fakeXhr();
  const first = uploadMediaRequest({ url: '/media', headers: {}, xhrFactory: () => xhr });
  xhr.ontimeout();
  await assert.rejects(first, { name: 'TimeoutError' });
  const second = uploadMediaRequest({ url: '/media', headers: {}, xhrFactory: () => xhr });
  xhr.status = 200;
  xhr.responseText = '<html>error</html>';
  xhr.onload();
  await assert.rejects(second, /invalid response/);
});

test('media JSON requests abort at deadline and preserve server error codes', async () => {
  await assert.rejects(requestMediaJson('/media', {}, { timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) }), { name: 'TimeoutError' });
  await assert.rejects(requestMediaJson('/media', {}, { fetcher: async () => new Response(JSON.stringify({ error: 'Removed', code: 'MEDIA_NOT_FOUND' }), { status: 404 }) }),
    (error) => error.status === 404 && error.code === 'MEDIA_NOT_FOUND');
});
