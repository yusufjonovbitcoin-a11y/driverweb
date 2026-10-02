import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudinaryMediaError } from './cloudinaryMediaErrors.js';
import { resolveDocumentMediaUrls, resolveProfileAvatarUrls } from './workspaceMediaResolver.js';

function documentClient(storagePath = 'cloudinary:00000000-0000-0000-0000-000000000001') {
  return {
    from(table) {
      assert.equal(table, 'document_versions');
      return {
        select() { return this; },
        async in(_field, ids) {
          return {
            data: ids.map((id) => ({
              id,
              storage_path: storagePath,
              mime_type: 'application/pdf',
              file_name: 'rate.pdf',
            })),
          };
        },
      };
    },
  };
}

const unavailableAsset = () => Promise.reject(new CloudinaryMediaError(
  'Media not found',
  404,
  'MEDIA_NOT_FOUND',
));

test('an unavailable document or avatar media asset does not abort workspace hydration', async () => {
  const documents = await resolveDocumentMediaUrls(
    documentClient(),
    [{ id: 'document-1', current_version_id: 'version-1' }],
    unavailableAsset,
  );
  assert.deepEqual(documents, [{
    id: 'document-1',
    current_version_id: 'version-1',
    signedUrl: null,
    mimeType: 'application/pdf',
    fileName: 'rate.pdf',
  }]);

  const avatars = await resolveProfileAvatarUrls(
    {},
    [{ id: 'member-1', avatar_path: 'cloudinary:00000000-0000-0000-0000-000000000002' }],
    unavailableAsset,
  );
  assert.equal(avatars.get('member-1'), null);
});

test('document version lookup batches multiple documents into one query', async () => {
  let versionQueries = 0;
  let requestedIds = [];
  const client = {
    from(table) {
      assert.equal(table, 'document_versions');
      return {
        select() { return this; },
        async in(field, ids) {
          assert.equal(field, 'id');
          versionQueries += 1;
          requestedIds = ids;
          return { data: ids.map((id) => ({
            id,
            storage_path: `cloudinary:${id}`,
            mime_type: 'application/pdf',
            file_name: `${id}.pdf`,
          })) };
        },
      };
    },
  };
  const documents = await resolveDocumentMediaUrls(client, [
    { id: 'doc-1', current_version_id: 'version-1' },
    { id: 'doc-2', current_version_id: 'version-2' },
    { id: 'doc-3', current_version_id: 'version-1' },
  ], async (path) => `signed:${path}`);

  assert.equal(versionQueries, 1);
  assert.deepEqual(requestedIds, ['version-1', 'version-2']);
  assert.equal(documents[0].signedUrl, 'signed:cloudinary:version-1');
  assert.equal(documents[1].fileName, 'version-2.pdf');
  assert.equal(documents[2].signedUrl, 'signed:cloudinary:version-1');
});

test('media authorization, server, and route errors still abort workspace hydration', async () => {
  for (const error of [
    new CloudinaryMediaError('Forbidden', 403, 'MEDIA_FORBIDDEN'),
    new CloudinaryMediaError('Lookup failed', 500, 'MEDIA_LOOKUP_FAILED'),
    new CloudinaryMediaError('Route missing', 404, null),
    new TypeError('Network unavailable'),
  ]) {
    const reject = () => Promise.reject(error);
    await assert.rejects(
      resolveDocumentMediaUrls(documentClient(), [{ id: 'document-1', current_version_id: 'version-1' }], reject),
      error,
    );
    await assert.rejects(
      resolveProfileAvatarUrls({}, [{ id: 'member-1', avatar_path: 'cloudinary:00000000-0000-0000-0000-000000000002' }], reject),
      error,
    );
  }
});
