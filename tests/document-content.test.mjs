import test from 'node:test';
import assert from 'node:assert/strict';
import { documentContentResponse } from '../supabase/functions/_shared/document-content.ts';
import { temporaryAuthenticatedDownloadUrl, signedAuthenticatedDeliveryUrl } from '../supabase/functions/_shared/cloudinary-delivery.ts';
import { withCors } from '../supabase/functions/_shared/cors.ts';

const id = '12345678-1234-1234-1234-123456789abc';
const version = { storage_path: `cloudinary:${id}`, mime_type: 'application/pdf', size_bytes: 100 };
const asset = { scope: 'load_document', mime_type: 'application/pdf', delivery_type: 'authenticated', resource_type: 'raw' };
const fixture = overrides => ({ readVersion: async () => version, readAsset: async () => asset,
  deliveryUrl: async () => 'https://res.cloudinary.com/private/signature/file.pdf', fetcher: async () => new Response('%PDF-original', { headers: { Location: 'secret', 'Content-Length': '13', 'X-Cld-Error': 'secret' } }), ...overrides });

test('streams the original PDF bytes without leaking the server-side signature or redirect', async () => {
  const response = await documentContentResponse(id, fixture());
  assert.equal(await response.text(), '%PDF-original');
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.has('Location'), false); assert.equal(response.headers.has('X-Cld-Error'), false);
});

test('denied versions/assets are rejected before any delivery signature or fetch', async () => {
  const forbidden = () => assert.fail('Denied content must never be fetched');
  for (const read of [{ readVersion: async () => null }, { readAsset: async () => null }]) {
    assert.equal((await documentContentResponse(id, fixture({ ...read, deliveryUrl: forbidden, fetcher: forbidden }))).status, 404);
  }
  assert.equal((await documentContentResponse('bad', fixture({ readVersion: forbidden }))).status, 400);
});

test('only authenticated load PDFs are accepted, with fixed delivery host and bounded file size', async () => {
  for (const invalid of [{ ...asset, scope: 'chat' }, { ...asset, deleted_at: 'yesterday' }, { ...asset, delivery_type: 'upload' }, { ...asset, resource_type: 'video' }]) {
    assert.ok((await documentContentResponse(id, fixture({ readAsset: async () => invalid, deliveryUrl: () => assert.fail('must not sign') }))).status >= 400);
  }
  assert.equal((await documentContentResponse(id, fixture({ readVersion: async () => ({ ...version, size_bytes: 51 * 1024 * 1024 }) }))).status, 413);
  await assert.rejects(documentContentResponse(id, fixture({ deliveryUrl: async () => 'http://localhost/private' })), /Invalid media host/);
});

test('upstream redirects/errors never escape as usable delivery URLs', async () => {
  const response = await documentContentResponse(id, fixture({ fetcher: async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response('private upstream URL', { status: 302, headers: { Location: 'https://res.cloudinary.com/secret' } });
  } }));
  assert.equal(response.status, 502); assert.equal(response.headers.has('Location'), false);
  assert.equal((await response.text()).includes('cloudinary.com'), false);
});

test('authenticated range requests preserve only the safe partial-content headers', async () => {
  const response = await documentContentResponse(id, fixture({ fetcher: async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-4');
    return new Response('%PDF-', { status: 206, headers: { 'Content-Length': '5', 'Content-Range': 'bytes 0-4/100', 'Accept-Ranges': 'bytes' } });
  } }), undefined, 'bytes=0-4');
  assert.equal(response.status, 206); assert.equal(await response.text(), '%PDF-');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-4/100');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await documentContentResponse(id, fixture({ readVersion: () => assert.fail() }), undefined, 'bytes=0-1,4-5')).status, 416);
});

test('a lightweight preview is authenticated and expires without returning its upstream URL', async () => {
  const url = new URL(await temporaryAuthenticatedDownloadUrl({ cloudName: 'test', apiKey: 'test', apiSecret: 'test', publicId: 'document', resourceType: 'image', format: 'pdf', timestamp: 100, expiresAt: 220, transformation: 'pg_1,w_1400,q_65,f_jpg' }));
  assert.equal(url.searchParams.get('transformation'), 'pg_1,w_1400,q_65,f_jpg');
  assert.equal(url.searchParams.get('expires_at'), '220');
  const response = await documentContentResponse(id, fixture({ readAsset: async () => ({ ...asset, resource_type: 'image' }),
    previewUrl: async () => 'https://res.cloudinary.com/preview', fetcher: async () => new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } }) }), undefined, null, true);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.has('Location'), false); assert.equal((await response.arrayBuffer()).byteLength, 3);
  assert.equal((await documentContentResponse(id, fixture(), undefined, null, true)).status, 415);
});

test('a missing preview is generated once through the expiring API, while both URLs remain server-side', async () => {
  const hosts = [];
  const response = await documentContentResponse(id, fixture({ readAsset: async () => ({ ...asset, resource_type: 'image' }),
    previewUrl: async () => 'https://res.cloudinary.com/preview', previewFallbackUrl: async () => 'https://api.cloudinary.com/temporary',
    fetcher: async url => { hosts.push(new URL(url).hostname); return hosts.length === 1 ? new Response('', { status: 401 }) : new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } }); },
  }), undefined, null, true);
  assert.equal(response.status, 200); assert.deepEqual(hosts, ['res.cloudinary.com', 'api.cloudinary.com']);
  assert.equal(response.headers.has('Location'), false);
});

test('GET/range preflight is opt-in and existing function CORS defaults remain unchanged', async () => {
  const request = new Request('http://localhost', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5174' } });
  const original = await withCors(request, () => assert.fail('preflight must not execute a handler'));
  assert.equal(original.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  const reader = await withCors(request, () => assert.fail(), { allowedMethods: 'GET, POST, OPTIONS', allowedHeaders: 'authorization,range' });
  assert.equal(reader.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(reader.headers.get('Access-Control-Allow-Headers'), 'authorization,range');
});

test('adding preview transformations preserves existing original-file delivery signatures', async () => {
  const url = await signedAuthenticatedDeliveryUrl({ cloudName: 'demo-cloud', apiSecret: 'test-secret', publicId: 'drivex/company/chat/message-file', resourceType: 'image', version: 1700000000, format: 'png' });
  assert.equal(url, 'https://res.cloudinary.com/demo-cloud/image/authenticated/s--a39XTNpu--/v1700000000/drivex/company/chat/message-file.png');
});
