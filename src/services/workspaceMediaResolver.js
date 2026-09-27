import {
  isCloudinaryReference,
  isMissingCloudinaryMediaError,
} from './cloudinaryMediaErrors.js';

export async function resolveDocumentMediaUrls(client, documents, signMedia) {
  return Promise.all(documents.map(async (document) => {
    if (!document.current_version_id) return document;
    const { data: version } = await client
      .from('document_versions')
      .select('storage_path,mime_type,file_name')
      .eq('id', document.current_version_id)
      .maybeSingle();
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
    const { data } = await client.storage.from('load-documents').createSignedUrl(version.storage_path, 3600);
    return {
      ...document,
      signedUrl: data?.signedUrl || null,
      mimeType: version.mime_type || null,
      fileName: version.file_name || null,
    };
  }));
}

export async function resolveProfileAvatarUrls(client, members, signMedia) {
  const entries = await Promise.all(members.map(async (member) => {
    if (!member.avatar_path) return [member.id, null];
    if (isCloudinaryReference(member.avatar_path)) {
      try {
        return [member.id, await signMedia(member.avatar_path)];
      } catch (error) {
        if (isMissingCloudinaryMediaError(error)) return [member.id, null];
        throw error;
      }
    }
    const { data } = await client.storage.from('profile-media').createSignedUrl(member.avatar_path, 3600);
    return [member.id, data?.signedUrl || null];
  }));
  return new Map(entries);
}
