import { freshTripDocumentUrl } from './tripDocumentUrl.js';

export async function resolveTripDocumentSource(document) {
  if (!document.versionId) {
    if (!document.url) throw new Error('DOCUMENT_UNAVAILABLE');
    return { mediaUrl: document.url, mimeType: document.mimeType, fileName: document.fileName };
  }
  const [{ requireSupabase }, { cloudinarySignedUrl }] = await Promise.all([
    import('../lib/supabase.js'), import('./cloudinaryMediaService.js'),
  ]);
  return freshTripDocumentUrl(requireSupabase(), document.versionId, cloudinarySignedUrl);
}

// Every download/merge resolves the durable ID, never a cached signed URL.
// A rejected URL gets one refresh; a rejected permission lookup never falls back.
export async function fetchTripDocument(document, {
  resolveSource = resolveTripDocumentSource, fetchDocument = fetch, signal,
} = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const source = await resolveSource(document);
    signal?.throwIfAborted();
    const response = await fetchDocument(source.mediaUrl, { signal });
    if (!response.ok) {
      if (!attempt && document.versionId && [400, 401, 403].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      throw new Error(`DOCUMENT_DOWNLOAD_FAILED_${response.status}`);
    }
    const blob = await response.blob();
    signal?.throwIfAborted();
    return { ...source, blob };
  }
}

export function saveDocumentBlob(blob, fileName, {
  dom = globalThis.document, urls = URL, schedule = setTimeout,
} = {}) {
  const url = urls.createObjectURL(blob);
  const link = dom.createElement('a');
  link.href = url;
  link.download = (fileName || 'document').replace(/[\\/]/g, '_');
  link.hidden = true;
  try {
    dom.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    schedule(() => urls.revokeObjectURL(url), 60_000);
  }
}
