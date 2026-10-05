import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

async function moduleFrom(relative) {
  const bundle = await rolldown({ input: new URL(relative, import.meta.url).pathname });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
}
const { parseMediaCleanupPayload, deleteCloudinaryMedia } = await moduleFrom('../supabase/functions/_shared/media-cleanup.ts');
const { shouldSendPush } = await moduleFrom('../supabase/functions/_shared/push-delivery-guard.ts');

test('chat cleanup accepts only an explicit message identity and its private bucket', () => {
  const job = { provider: 'supabase_storage', messageId: 'message-1', bucket: 'chat-media', storagePath: 'company/conversation/client/photo.png' };
  assert.equal(parseMediaCleanupPayload(job).messageId, 'message-1');
  assert.throws(() => parseMediaCleanupPayload({ ...job, bucket: 'load-documents' }), /Unsupported storage bucket/);
  assert.throws(() => parseMediaCleanupPayload({ ...job, documentVersionId: 'v1' }), /Ambiguous/);
  assert.throws(() => parseMediaCleanupPayload({ ...job, storagePath: '/company/file' }), /Unsafe/);
  assert.throws(() => parseMediaCleanupPayload({ ...job, storagePath: 'company/../file' }), /Unsafe/);
  assert.equal(parseMediaCleanupPayload({ provider: 'supabase_storage', documentVersionId: 'v1', bucket: 'load-documents', storagePath: 'company/load/file.pdf' }).documentVersionId, 'v1');
});

test('legacy Cloudinary chat cleanup remains idempotent and invalidates delivery', async () => {
  const payload = parseMediaCleanupPayload({ provider: 'cloudinary', messageId: 'm1', mediaRef: 'cloudinary:a1', mediaAssetId: 'a1', publicId: 'drivex/company/chat/file', resourceType: 'image', deliveryType: 'authenticated' });
  await deleteCloudinaryMedia(payload, { cloudName: 'test', apiKey: 'test', apiSecret: 'test', fetcher: async (url, init) => {
    assert.equal(url, 'https://api.cloudinary.com/v1_1/test/image/destroy');
    assert.equal(init.body.get('invalidate'), 'true');
    assert.equal(init.body.get('public_id'), payload.publicId);
    return Response.json({ result: 'not found' });
  } });
});

test('push guard refuses deleted, missing, cancelled or stolen-lease notifications', () => {
  const candidate = { workerId: 'worker', lease: { status: 'processing', locked_by: 'worker' }, notification: { type: 'chat_message', title: 'Driver', body: 'Hello', chat_message_id: 'm1' }, message: { deleted_at: null } };
  assert.equal(shouldSendPush(candidate), true);
  assert.equal(shouldSendPush({ ...candidate, message: { deleted_at: '2026-10-05' } }), false);
  assert.equal(shouldSendPush({ ...candidate, message: null }), false);
  assert.equal(shouldSendPush({ ...candidate, notification: { ...candidate.notification, type: 'chat_message_deleted' } }), false);
  assert.equal(shouldSendPush({ ...candidate, lease: { status: 'cancelled', locked_by: null } }), false);
  assert.equal(shouldSendPush({ ...candidate, workerId: 'other' }), false);
  assert.equal(shouldSendPush({ ...candidate, notification: { type: 'load_offer', title: 'Load', body: 'Ready' }, message: null }), true);
});

const storageBundle = await rolldown({
  input: new URL('../src/services/chatStorageService.js', import.meta.url).pathname,
  plugins: [{ name: 'isolated-supabase', resolveId(id) { if (id.endsWith('/lib/supabase')) return '\0fake-client'; }, load(id) {
    if (id === '\0fake-client') return "export const requireSupabase=()=>globalThis.testClient; export const supabaseUrl='https://test.invalid'; export const supabaseAnonKey='public-test-key';";
  } }],
});
const { output: storageCode } = await storageBundle.generate({ format: 'iife', name: 'chatStorage' });
await storageBundle.close();

function storageHarness(status = 200, payload = null) {
  const requests = [];
  const sandbox = { DOMException, Date, setTimeout, clearTimeout, testClient: { rpc: async (name, args) => { assert.equal(name, 'register_chat_media_upload'); assert.ok(args.target_path); return { error: null }; }, auth: { getSession: async () => ({ data: { session: { access_token: 'test-token', expires_at: Date.now() / 1000 + 3600 } } }) } }, XMLHttpRequest: class {
    upload = {};
    headers = {};
    status = status;
    responseText = JSON.stringify(payload || (status === 409 ? { error: 'Duplicate' } : { Key: 'chat-media/company/chat/op/file.png' }));
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; requests.push(this); queueMicrotask(() => this.onload()); }
  } };
  vm.runInNewContext(storageCode[0].code, sandbox);
  return { upload: sandbox.chatStorage.uploadChatMedia, requests };
}

test('new chat uploads go directly to private Supabase Storage with real cancellation/progress transport', async () => {
  const { upload, requests } = storageHarness();
  const file = { name: 'photo name.png', type: 'image/png', size: 40 };
  const result = await upload({ file, path: 'company/chat/stable-id/photo name.png' });
  assert.equal(result.reference, 'company/chat/stable-id/photo name.png');
  assert.equal(requests[0].url, 'https://test.invalid/storage/v1/object/chat-media/company/chat/stable-id/photo%20name.png');
  assert.equal(requests[0].headers['x-upsert'], 'false');
  assert.equal(requests[0].body, file);
  assert.equal(requests[0].timeout, 120000);
});

test('stable operation retries acknowledge an existing object without overwriting it', async () => {
  const { upload } = storageHarness(409);
  const result = await upload({ file: { name: 'photo.png', type: 'image/png', size: 40 }, path: 'company/chat/stable-id/photo.png' });
  assert.equal(result.reference, 'company/chat/stable-id/photo.png');
});

test('legacy 400 duplicate is retry-safe but unrelated errors still fail', async () => {
  const input = { file: { name: 'photo.png', type: 'image/png', size: 40 }, path: 'company/chat/stable-id/photo.png' };
  assert.equal((await storageHarness(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }).upload(input)).reference, input.path);
  await assert.rejects(storageHarness(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }).upload(input), /row-level security/);
  await assert.rejects(storageHarness(409, { error: 'ResourceLocked', message: 'File is locked' }).upload(input), /locked/);
});

test('chat uploads reject empty/oversized files and unsafe keys before sending', async () => {
  const { upload, requests } = storageHarness();
  const base = { file: { name: 'x.pdf', type: 'application/pdf', size: 40 }, path: 'company/chat/id/x.pdf' };
  await assert.rejects(upload({ ...base, file: { ...base.file, size: 0 } }), /50 MB/);
  await assert.rejects(upload({ ...base, file: { ...base.file, size: 50 * 1024 * 1024 + 1 } }), /50 MB/);
  await assert.rejects(upload({ ...base, path: 'company/chat/../x.pdf' }), /Invalid/);
  await assert.rejects(upload({ ...base, path: 'company/chat/id/x\0.pdf' }), /Invalid/);
  assert.equal(requests.length, 0);
});
