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

test('workspace Storage signatures are reused across refreshes and separated by bucket', async () => {
  const client = documentClient('company/shared.pdf');
  client.auth = {
    async getSession() { return { data: { session: { user: { id: 'admin-a' } } } }; },
    onAuthStateChange() {},
  };
  const requests = [];
  client.storage = { from(bucket) {
    return { async createSignedUrl(path, lifetime) {
      assert.equal(lifetime, 3600);
      requests.push(`${bucket}:${path}`);
      return { data: { signedUrl: `signed:${bucket}:${path}` } };
    } };
  } };
  const records = [
    { id: 'document-1', current_version_id: 'version-1' },
    { id: 'document-2', current_version_id: 'version-2' },
  ];
  const first = await resolveDocumentMediaUrls(client, records);
  await resolveDocumentMediaUrls(client, records);
  const avatars = await resolveProfileAvatarUrls(client, [{ id: 'driver-a', avatar_path: 'company/shared.pdf' }]);
  assert.equal(first[0].signedUrl, 'signed:load-documents:company/shared.pdf');
  assert.equal(avatars.get('driver-a'), 'signed:profile-media:company/shared.pdf');
  assert.deepEqual(requests, ['load-documents:company/shared.pdf', 'profile-media:company/shared.pdf']);
});

function storageError(message, status, code, statusCode = String(status)) {
  return Object.assign(new Error(message), { name: 'StorageApiError', status, code, statusCode });
}

function storageClient(resolve) {
  const client = documentClient('company/document.pdf');
  client.auth = {
    async getSession() { return { data: { session: { user: { id: 'admin-a' } } } }; },
    onAuthStateChange() {},
  };
  client.storage = { from(bucket) { return { createSignedUrl: () => resolve(bucket) }; } };
  return client;
}

test('missing Storage documents and avatars remain optional and retry on the next hydration', async () => {
  for (const error of [
    storageError('The specified key does not exist', 404, 'NoSuchKey'),
    storageError('Object not found', 404, 'not_found'),
    storageError('Object not found', 400, undefined, '404'),
  ]) {
    let missing = true;
    let requests = 0;
    const client = storageClient(async (bucket) => {
      requests += 1;
      return missing ? { error } : { data: { signedUrl: `signed:${bucket}` } };
    });
    const documents = [{ id: 'document-1', current_version_id: 'version-1' }];
    const members = [{ id: 'driver-1', avatar_path: 'company/avatar.png' }];
    assert.equal((await resolveDocumentMediaUrls(client, documents))[0].signedUrl, null);
    assert.equal((await resolveProfileAvatarUrls(client, members)).get('driver-1'), null);
    missing = false;
    assert.equal((await resolveDocumentMediaUrls(client, documents))[0].signedUrl, 'signed:load-documents');
    assert.equal((await resolveProfileAvatarUrls(client, members)).get('driver-1'), 'signed:profile-media');
    await resolveDocumentMediaUrls(client, documents);
    await resolveProfileAvatarUrls(client, members);
    assert.equal(requests, 4);
  }
});

test('Storage authorization, missing bucket, route and network errors still propagate', async () => {
  for (const error of [
    storageError('Invalid JWT', 401, 'InvalidJWT'),
    storageError('Access denied', 403, 'AccessDenied'),
    storageError('Bucket not found', 404, 'NoSuchBucket'),
    storageError('Not Found', 404, undefined),
    storageError('Internal server error', 500, 'InternalError'),
    new TypeError('Network unavailable'),
  ]) {
    const client = storageClient(async () => ({ error }));
    await assert.rejects(resolveDocumentMediaUrls(client, [{ id: 'doc', current_version_id: 'version' }]), error);
    await assert.rejects(resolveProfileAvatarUrls(client, [{ id: 'driver', avatar_path: 'company/avatar.png' }]), error);
  }
});
