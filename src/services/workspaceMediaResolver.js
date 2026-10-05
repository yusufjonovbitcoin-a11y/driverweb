import {
  isCloudinaryReference,
  isMissingCloudinaryMediaError,
} from './cloudinaryMediaErrors.js';
import { cachedSignedMediaUrl } from './mediaUrlCache.js';
import { mapWithConcurrency } from './readAllRows.js';

function isMissingStorageObject(error) {
  if (error?.name !== 'StorageApiError' || ![400, 404].includes(Number(error.status))) return false;
  const code = error.code || error.statusCode;
  if (code === 'NoSuchKey') return true;
  // Older Storage versions report a missing object as HTTP 400 with a 404
  // body. Do not hide a missing bucket/route, authorization or network error.
  return ['not_found', '404'].includes(String(code))
    && /^(object|file) not found[.!]?$/i.test(error.message || '');
}

function storageSignedUrl(client, bucket, path) {
  return cachedSignedMediaUrl(client, `storage:${bucket}:${path}`, async () => {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) {
      if (isMissingStorageObject(error)) return null;
      throw error;
    }
    return data?.signedUrl || null;
  });
}

export async function resolveDocumentMediaUrls(client, documents, signMedia) {
  const versionIds = [...new Set(documents.map((document) => document.current_version_id).filter(Boolean))];
  const versionBatches = [];
  for (let index = 0; index < versionIds.length; index += 100) {
    versionBatches.push(versionIds.slice(index, index + 100));
  }
  const versions = await mapWithConcurrency(versionBatches, async (ids) => {
    const { data, error } = await client
      .from('document_versions')
      .select('id,storage_path,mime_type,file_name')
      .in('id', ids);
    if (error) throw error;
    return data || [];
  });
  const versionsById = new Map(versions.flat().map((version) => [version.id, version]));

  return mapWithConcurrency(documents, async (document) => {
    if (!document.current_version_id) return document;
    const version = versionsById.get(document.current_version_id);
    if (!version?.storage_path) return document;
    if (isCloudinaryReference(version.storage_path)) {
      let signedUrl = null;
      try {
        signedUrl = await signMedia(version.storage_path);
      } catch (error) {
        if (!isMissingCloudinaryMediaError(error)) throw error;
      }
      return {
        ...document,
        signedUrl,
        mimeType: version.mime_type || null,
        fileName: version.file_name || null,
      };
    }
    const signedUrl = await storageSignedUrl(client, 'load-documents', version.storage_path);
    return {
      ...document,
      signedUrl,
      mimeType: version.mime_type || null,
      fileName: version.file_name || null,
    };
  });
}

export async function resolveProfileAvatarUrls(client, members, signMedia) {
  const entries = await mapWithConcurrency(members, async (member) => {
    if (!member.avatar_path) return [member.id, null];
    if (isCloudinaryReference(member.avatar_path)) {
      try {
        return [member.id, await signMedia(member.avatar_path)];
      } catch (error) {
        if (isMissingCloudinaryMediaError(error)) return [member.id, null];
        throw error;
      }
    }
    return [member.id, await storageSignedUrl(client, 'profile-media', member.avatar_path)];
  });
  return new Map(entries);
}
