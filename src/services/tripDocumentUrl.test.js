import test from 'node:test';
import assert from 'node:assert/strict';
import { freshTripDocumentUrl } from './tripDocumentUrl.js';
import { cachedSignedMediaUrl } from './mediaUrlCache.js';

function fixture({ path = 'company/load/version/rate.pdf', denied = false } = {}) {
  let signatures = 0;
  let actor = 'actor';
  const client = {
    auth: {
      onAuthStateChange() {},
      async getSession() { return { data: { session: actor ? { user: { id: actor } } : null } }; },
    },
    from(table) {
      assert.equal(table, 'document_versions');
      return { select() { return this; }, eq(column, id) { assert.equal(column, 'id'); assert.equal(id, 'version'); return this; },
        async single() { return denied ? { error: new Error('denied') } : { data: { storage_path: path, mime_type: 'application/pdf' } }; } };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'load-documents');
      return { async createSignedUrl(value, seconds) {
        assert.equal(value, path); assert.equal(seconds, 3600);
        return { data: { signedUrl: `https://example.test/document?signature=${++signatures}` } };
      } };
    } },
  };
  return { client, logout: () => { actor = null; } };
}

test('opening a durable trip version always gets a fresh URL, including later reopen', async () => {
  const { client } = fixture();
  const first = await freshTripDocumentUrl(client, 'version');
  const later = await freshTripDocumentUrl(client, 'version');
  assert.notEqual(first.mediaUrl, later.mediaUrl);
  assert.equal(later.mimeType, 'application/pdf');
});

test('legacy Cloudinary version cache is invalidated on each open', async () => {
  const path = 'cloudinary:raw:private/document';
  const { client } = fixture({ path });
  let signatures = 0;
  const sign = value => cachedSignedMediaUrl(client, value, async () => `https://example.test/${++signatures}`);
  assert.notEqual((await freshTripDocumentUrl(client, 'version', sign)).mediaUrl,
    (await freshTripDocumentUrl(client, 'version', sign)).mediaUrl);
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
