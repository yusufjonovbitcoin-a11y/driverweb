import { CloudinaryMediaError } from './cloudinaryMediaErrors.js';

const aborted = () => new DOMException('Media request cancelled.', 'AbortError');

export async function requestMediaJson(url, init, {
  fetcher = fetch, signal, timeoutMs = 20_000,
} = {}) {
  if (signal?.aborted) throw aborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Media request timed out.', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch((error) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (response.ok) throw error;
      return {};
    });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response.ok) throw new CloudinaryMediaError(
      payload.error || `Media error (${response.status})`, response.status, payload.code || null,
    );
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function uploadMediaRequest({
  url, headers, body, onProgress, signal, timeoutMs = 120_000,
  xhrFactory = () => new XMLHttpRequest(),
}) {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    let settled = false;
    const abort = () => { xhr.abort(); finish(aborted()); };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (!settled && event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => finish(new Error('Media serveriga ulanib bo‘lmadi.'));
    xhr.onabort = () => finish(aborted());
    xhr.ontimeout = () => finish(new DOMException('Media upload timed out.', 'TimeoutError'));
    xhr.onload = () => {
      let payload;
      try { payload = JSON.parse(xhr.responseText || '{}'); }
      catch { finish(new Error('Media server returned an invalid response.')); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(new CloudinaryMediaError(payload.message || payload.error || `Media error (${xhr.status})`, xhr.status, payload.code || payload.error || null));
        return;
      }
      onProgress?.(1);
      finish(null, payload);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { xhr.send(body); } catch (error) { finish(error); }
  });
}
