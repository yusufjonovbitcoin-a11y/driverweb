import { cachedSignedMediaUrl, invalidateSignedMediaUrl } from './mediaUrlCache.js';
import { isCloudinaryReference } from './cloudinaryMediaErrors.js';
import { measureDocumentStage } from './documentPerformance.js';

// Reauthorize the durable version on every open. Only its still-valid signature
// is reused, in the existing actor-scoped cache; a rejected URL forces renewal.
export async function freshTripDocumentUrl(client, versionId, signMedia, { forceRefresh = false, forPreview = false } = {}) {
  if (!versionId) throw new Error('DOCUMENT_VERSION_REQUIRED');
  const metadataTime = measureDocumentStage('authorize-version');
  const { data: version, error } = await client.from('document_versions')
    .select('id,storage_path,mime_type,file_name').eq('id', versionId).single();
  if (error) throw error;
  metadataTime();
  if (!version?.storage_path) throw new Error('DOCUMENT_UNAVAILABLE');
  const path = version.storage_path;
  // PDF previews use the authenticated byte-stream endpoint. It keeps the CDN
  // signature on the server and avoids the slow, uncached download-API route.
  if (forPreview && version.mime_type === 'application/pdf' && isCloudinaryReference(path)) {
    return { mediaUrl: null, mediaReference: path, mimeType: version.mime_type, fileName: version.file_name };
  }
  const signingTime = measureDocumentStage('sign-media-url');
  let mediaUrl;
  if (isCloudinaryReference(path)) {
    if (forceRefresh) invalidateSignedMediaUrl(client, path);
    mediaUrl = await signMedia(path);
  } else {
    const key = `storage:load-documents:${path}`;
    if (forceRefresh) invalidateSignedMediaUrl(client, key);
    mediaUrl = await cachedSignedMediaUrl(client, key, async () => {
      const result = await client.storage.from('load-documents').createSignedUrl(path, 3600);
      if (result.error) throw result.error;
      return result.data?.signedUrl;
    });
  }
  if (!mediaUrl) throw new Error('DOCUMENT_UNAVAILABLE');
  signingTime();
  return { mediaUrl, mimeType: version.mime_type, fileName: version.file_name };
}
