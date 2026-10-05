import { cachedSignedMediaUrl, invalidateSignedMediaUrl } from './mediaUrlCache.js';
import { isCloudinaryReference } from './cloudinaryMediaErrors.js';

// Resolve the durable version ID every time a document is opened. Never trust
// the signed URL held in a weeks-old workspace snapshot.
export async function freshTripDocumentUrl(client, versionId, signMedia) {
  if (!versionId) throw new Error('DOCUMENT_VERSION_REQUIRED');
  const { data: version, error } = await client.from('document_versions')
    .select('id,storage_path,mime_type,file_name').eq('id', versionId).single();
  if (error) throw error;
  if (!version?.storage_path) throw new Error('DOCUMENT_UNAVAILABLE');
  const path = version.storage_path;
  let mediaUrl;
  if (isCloudinaryReference(path)) {
    invalidateSignedMediaUrl(client, path);
    mediaUrl = await signMedia(path);
  } else {
    const key = `storage:load-documents:${path}`;
    invalidateSignedMediaUrl(client, key);
    mediaUrl = await cachedSignedMediaUrl(client, key, async () => {
      const result = await client.storage.from('load-documents').createSignedUrl(path, 3600);
      if (result.error) throw result.error;
      return result.data?.signedUrl;
    });
  }
  if (!mediaUrl) throw new Error('DOCUMENT_UNAVAILABLE');
  return { mediaUrl, mimeType: version.mime_type, fileName: version.file_name };
}
