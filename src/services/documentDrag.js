import { fetchTripDocument } from './tripDocumentAccess.js';

export function documentDataUrl(file, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const reader = new FileReader();
    const abort = () => reader.abort();
    const finish = (callback, value) => {
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    reader.onload = () => finish(resolve, reader.result);
    reader.onerror = () => finish(reject, reader.error || new Error('DOCUMENT_READ_FAILED'));
    reader.onabort = () => finish(reject, new DOMException('Document closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(file);
  });
}

export async function prepareDocumentDrag(document, {
  signal, fetchFile = fetchTripDocument, toDataUrl = documentDataUrl,
} = {}) {
  const source = await fetchFile(document, { signal });
  signal?.throwIfAborted();
  const type = source.mimeType || source.blob.type || 'application/octet-stream';
  const extension = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type] || '';
  const name = (source.fileName || `${document.id || 'document'}${extension}`).replace(/[\\/:\r\n]/g, '_');
  const file = new File([source.blob], name, { type });
  const dragUrl = await toDataUrl(file, signal);
  signal?.throwIfAborted();
  return { file, dragUrl };
}

// Called synchronously inside a user-initiated dragstart. Only a copy is shared;
// the original stays private. No signed server URL is exposed in the payload.
export function setDocumentDragData(dataTransfer, file, dragUrl) {
  dataTransfer.effectAllowed = 'copy';
  try { dataTransfer.items?.add?.(file); } catch { /* Chromium fallback below. */ }
  const name = file.name.replace(/[\\/:\r\n]/g, '_');
  dataTransfer.setData('DownloadURL', `${file.type || 'application/octet-stream'}:${name}:${dragUrl}`);
  dataTransfer.setData('text/uri-list', dragUrl);
}
