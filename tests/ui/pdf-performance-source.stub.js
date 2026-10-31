import { createDocumentContentCache, fetchPdfContent } from '../../src/services/documentContentCache.js';
const content = createDocumentContentCache(); content.setScope('test-actor');

export async function resolveTripDocumentSource(document, { forceRefresh = false } = {}) {
  window.fixtureSourceCalls.push({ versionId: document.versionId, forceRefresh });
  window.fixtureSourcePending = true;
  await new Promise(resolve => setTimeout(resolve, 700));
  window.fixtureSourcePending = false;
  if (window.fixtureSourceDenied) throw Error('Permission denied');
  if (forceRefresh) content.delete(document.versionId);
  const expired = new URLSearchParams(location.search).has('expired');
  const mediaUrl = expired && !forceRefresh ? '/tests/ui/expired-pdf.pdf' : window.fixturePdfUrl;
  return { mediaUrl, mimeType: 'application/pdf', fileName: 'synthetic.pdf',
    loadPdfPreview: new URLSearchParams(location.search).has('preview') ? async () => (await fetch(window.fixturePreviewUrl)).blob() : undefined,
    loadPdfData: async ({ signal, onProgress }) => {
      if (new URLSearchParams(location.search).has('preview')) { await new Promise(resolve => setTimeout(resolve, 5000)); signal.throwIfAborted(); }
      if (new URLSearchParams(location.search).has('ranges')) return { url: '/tests/ui/range.pdf', disableStream: false, disableAutoFetch: false, rangeChunkSize: 65536 };
      const blob = await content.load(document.versionId, transfer => {
        window.fixtureContentCalls = (window.fixtureContentCalls || 0) + 1;
        return fetchPdfContent(mediaUrl, { ...transfer, idleMs: 250, totalMs: 3000,
          fetcher: new URLSearchParams(location.search).has('stalled') ? async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('%PDF-')); } })) : fetch });
      }, { signal, onProgress });
      return new Uint8Array(await blob.arrayBuffer());
    } };
}
export function fetchTripDocument() { throw Error('Not used by PDF rendering checks'); }
export function saveDocumentBlob() {}
