export async function resolveTripDocumentSource(document) {
  (window.registryWarmups ||= []).push(document.versionId);
  return { mediaUrl: 'blob:synthetic-warmup', mimeType: 'application/pdf', loadPdfData: async () => new Uint8Array() };
}

export async function fetchTripDocument(document, { signal } = {}) {
  window.registryDownloads.push({ versionId: document.versionId, documentId: document.documentId, stopId: document.stopId, fileName: document.fileName });
  if (window.registryDownloadMode === 'fail') throw Error('Synthetic download failure');
  if (window.registryDownloadMode === 'slow') await new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { window.registryDownloadAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  signal?.throwIfAborted();
  return { blob: new Blob([`Synthetic document ${document.versionId}`], { type: 'application/pdf' }), fileName: document.fileName, mimeType: 'application/pdf' };
}
export function saveDocumentBlob(blob, fileName) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
