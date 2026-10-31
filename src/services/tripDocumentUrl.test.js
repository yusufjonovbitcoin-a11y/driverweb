import test from 'node:test';
import assert from 'node:assert/strict';
import { freshTripDocumentUrl } from './tripDocumentUrl.js';
import { cachedSignedMediaUrl } from './mediaUrlCache.js';

function fixture({ path = 'company/load/version/rate.pdf', denied = false } = {}) {
  let signatures = 0;
  let actor = 'actor';
  let lookups = 0;
  const client = {
    auth: {
      onAuthStateChange() {},
      async getSession() { return { data: { session: actor ? { user: { id: actor } } : null } }; },
    },
    from(table) {
      assert.equal(table, 'document_versions');
      return { select() { return this; }, eq(column, id) { assert.equal(column, 'id'); assert.equal(id, 'version'); return this; },
        async single() { lookups++; return denied ? { error: new Error('denied') } : { data: { storage_path: path, mime_type: 'application/pdf' } }; } };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'load-documents');
      return { async createSignedUrl(value, seconds) {
        assert.equal(value, path); assert.equal(seconds, 3600);
        return { data: { signedUrl: `https://example.test/document?signature=${++signatures}` } };
      } };
    } },
  };
  return { client, logout: () => { actor = null; }, deny: () => { denied = true; }, changeActor: () => { actor = 'other-actor'; }, stats: () => ({ signatures, lookups }) };
}

test('reopening reauthorizes the durable version and reuses its valid signature', async () => {
  const { client, stats } = fixture();
  const first = await freshTripDocumentUrl(client, 'version');
  const later = await freshTripDocumentUrl(client, 'version');
  assert.equal(first.mediaUrl, later.mediaUrl);
  assert.equal(later.mimeType, 'application/pdf');
  assert.deepEqual(stats(), { signatures: 1, lookups: 2 });
});

test('Cloudinary shares the valid actor-scoped signature and renews only on rejection', async () => {
  const path = 'cloudinary:raw:private/document';
  const { client } = fixture({ path });
  let signatures = 0;
  const sign = value => cachedSignedMediaUrl(client, value, async () => `https://example.test/${++signatures}`);
  const first = await freshTripDocumentUrl(client, 'version', sign);
  assert.equal(first.mediaUrl, (await freshTripDocumentUrl(client, 'version', sign)).mediaUrl);
  assert.notEqual(first.mediaUrl, (await freshTripDocumentUrl(client, 'version', sign, { forceRefresh: true })).mediaUrl);
  assert.equal(signatures, 2);
});

test('forced storage renewal replaces the old signature, while permissions are checked again', async () => {
  const { client, stats } = fixture();
  const first = await freshTripDocumentUrl(client, 'version');
  const next = await freshTripDocumentUrl(client, 'version', undefined, { forceRefresh: true });
  assert.notEqual(first.mediaUrl, next.mediaUrl);
  assert.deepEqual(stats(), { signatures: 2, lookups: 2 });
});

test('authenticated PDF previews authorize the version without requesting a download-API signature', async () => {
  const { client, stats } = fixture({ path: 'cloudinary:12345678-1234-1234-1234-123456789abc' });
  const source = await freshTripDocumentUrl(client, 'version', () => assert.fail('Preview must use authenticated content delivery'), { forPreview: true });
  assert.equal(source.mediaUrl, null); assert.equal(source.mimeType, 'application/pdf');
  assert.ok(source.mediaReference.startsWith('cloudinary:'));
  assert.deepEqual(stats(), { signatures: 0, lookups: 1 });
});

test('cached media does not bypass revoked permissions or cross actor boundaries', async () => {
  const denied = fixture();
  await freshTripDocumentUrl(denied.client, 'version');
  denied.deny();
  await assert.rejects(freshTripDocumentUrl(denied.client, 'version'), /denied/);
  assert.deepEqual(denied.stats(), { signatures: 1, lookups: 2 });
  const actor = fixture();
  const first = await freshTripDocumentUrl(actor.client, 'version');
  actor.changeActor();
  assert.notEqual(first.mediaUrl, (await freshTripDocumentUrl(actor.client, 'version')).mediaUrl);
});

test('denied, missing, or signed-out document never falls back to a stale URL', async () => {
  await assert.rejects(freshTripDocumentUrl(fixture({ denied: true }).client, 'version'), /denied/);
  await assert.rejects(freshTripDocumentUrl(fixture({ path: null }).client, 'version'), /DOCUMENT_UNAVAILABLE/);
  await assert.rejects(freshTripDocumentUrl(fixture().client, ''), /DOCUMENT_VERSION_REQUIRED/);
  const { client, logout } = fixture();
  await freshTripDocumentUrl(client, 'version');
  logout();
  await assert.rejects(freshTripDocumentUrl(client, 'version'), { name: 'AbortError' });
});
