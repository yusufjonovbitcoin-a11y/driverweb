import { freshTripDocumentUrl } from './tripDocumentUrl.js';
import { documentContentSession, fetchPdfContent } from './documentContentCache.js';

export async function resolveTripDocumentSource(document, options = {}) {
  if (!document.versionId) {
    if (!document.url) throw new Error('DOCUMENT_UNAVAILABLE');
    return { mediaUrl: document.url, mimeType: document.mimeType, fileName: document.fileName };
  }
  const [{ requireSupabase }, { cloudinarySignedUrl, fetchTripDocumentContentResponse }] = await Promise.all([
    import('../lib/supabase.js'), import('./cloudinaryMediaService.js'),
  ]);
  const client = requireSupabase();
  const session = await documentContentSession(client);
  const source = await freshTripDocumentUrl(client, document.versionId, cloudinarySignedUrl, options);
  session.assertCurrent();
  if (options.forceRefresh) session.delete(document.versionId);
  return { ...source,
    loadPdfPreview: source.mediaReference ? ({ signal } = {}) => session.load(`${document.versionId}:preview`, transfer => fetchPdfContent(null, {
      ...transfer, imagePreview: true, fetcher: (_url, { signal: transferSignal }) => fetchTripDocumentContentResponse(document.versionId, { signal: transferSignal, preview: true }),
    }), { signal }) : undefined,
    loadPdfData: async ({ signal, onProgress } = {}) => {
    // This capability is created only after the fresh version/RLS check above.
    const blob = await session.load(document.versionId, transfer => fetchPdfContent(source.mediaUrl, {
      ...transfer, ...(source.mediaReference ? { fetcher: (_url, { signal: transferSignal }) => fetchTripDocumentContentResponse(document.versionId, { signal: transferSignal }) } : {}),
    }), { signal, onProgress });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    session.assertCurrent(); signal?.throwIfAborted();
    return bytes;
  } };
}

// Every download/merge reauthorizes the durable ID before reusing its signature.
// A rejected URL gets one refresh; a rejected permission lookup never falls back.
export async function fetchTripDocument(document, {
  resolveSource = resolveTripDocumentSource, fetchDocument = fetch, signal,
} = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const source = await resolveSource(document, { forceRefresh: attempt > 0 });
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
