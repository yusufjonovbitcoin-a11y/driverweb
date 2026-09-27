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
        eq() { return this; },
        async maybeSingle() {
          return {
            data: {
              storage_path: storagePath,
              mime_type: 'application/pdf',
              file_name: 'rate.pdf',
            },
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
