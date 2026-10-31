import { measureDocumentStage } from './documentPerformance.js';

const cancelled = () => new DOMException('Document request cancelled.', 'AbortError');

// Immutable Blobs, never PDF.js-owned (transferable) buffers. No disk storage.
export function createDocumentContentCache({ maxBytes = 64 * 1024 * 1024, maxEntries = 6, ttlMs = 10 * 60_000, now = Date.now } = {}) {
  const entries = new Map();
  let scope = null, generation = 0;
  const remove = key => { const entry = entries.get(key); entries.delete(key); entry?.controller.abort(); };
  const clear = () => { generation++; for (const key of entries.keys()) remove(key); };
  return {
    get generation() { return generation; },
    setScope(next) { if (scope !== next) { scope = next; clear(); } },
    clear,
    delete: remove,
    load(key, loader, { signal, onProgress } = {}) {
      if (!scope || signal?.aborted) return Promise.reject(cancelled());
      for (const [id, entry] of entries) if (entry.blob && entry.until <= now()) remove(id);
      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController(), started = generation;
        entry = { controller, listeners: new Set(), blob: null, until: 0, progress: null };
        entries.set(key, entry);
        entry.promise = Promise.resolve().then(() => loader({ signal: controller.signal, onProgress: progress => {
          entry.progress = progress;
          for (const listener of entry.listeners) listener(progress);
        } })).then(blob => {
          if (started !== generation || controller.signal.aborted) throw cancelled();
          entry.blob = blob; entry.until = now() + ttlMs;
          let bytes = [...entries.values()].reduce((sum, value) => sum + (value.blob?.size || 0), 0);
          for (const [id, value] of entries) {
            if (bytes <= maxBytes && entries.size <= maxEntries) break;
            if (!value.blob) continue;
            bytes -= value.blob.size;
            // Eviction drops the cache reference, without cancelling consumers.
            entries.delete(id);
          }
          return blob;
        }).catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
      } else { entries.delete(key); entries.set(key, entry); }
      return new Promise((resolve, reject) => {
        const listener = progress => onProgress?.(progress);
        const cleanup = () => { entry.listeners.delete(listener); signal?.removeEventListener('abort', abort); };
        const abort = () => {
          cleanup(); reject(cancelled());
          // A StrictMode effect replay / second consumer can subscribe first.
          queueMicrotask(() => { if (!entry.blob && !entry.listeners.size && entries.get(key) === entry) remove(key); });
        };
        entry.listeners.add(listener);
        signal?.addEventListener('abort', abort, { once: true });
        if (entry.progress) listener(entry.progress);
        entry.promise.then(blob => { cleanup(); if (!signal?.aborted) resolve(blob); }, error => { cleanup(); reject(error); });
      });
    },
  };
}

const clients = new WeakMap();
export async function documentContentSession(client) {
  let state = clients.get(client);
  if (!state) {
    state = { cache: createDocumentContentCache(), actor: null, authVersion: 0 };
    clients.set(client, state);
    client.auth.onAuthStateChange((event, session) => {
      state.authVersion++;
      state.actor = session?.user?.id || null;
      state.cache.setScope(state.actor);
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') state.cache.clear();
    });
  }
  const authVersion = state.authVersion;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const actor = data.session?.user?.id || null;
  if (!actor || authVersion !== state.authVersion && actor !== state.actor) throw cancelled();
  state.actor = actor; state.cache.setScope(actor);
  const generation = state.cache.generation;
  const assertCurrent = () => { if (generation !== state.cache.generation || actor !== state.actor) throw cancelled(); };
  return { assertCurrent, delete: key => { assertCurrent(); state.cache.delete(key); },
    async load(key, loader, options) { assertCurrent(); const blob = await state.cache.load(key, loader, options); assertCurrent(); return blob; } };
}

// Own the transfer so a broken response body cannot leave PDF.js spinning forever.
export async function fetchPdfContent(url, { signal, onProgress, fetcher = fetch, idleMs = 12_000, totalMs = 45_000, imagePreview = false } = {}) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || cancelled());
  signal?.addEventListener('abort', abort, { once: true });
  let idleTimer;
  const timeout = () => controller.abort(new DOMException('PDF download timed out.', 'TimeoutError'));
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(timeout, idleMs); };
  const timer = setTimeout(timeout, totalMs);
  const finished = measureDocumentStage(imagePreview ? 'download-preview-bytes' : 'download-pdf-bytes');
  try {
    touch();
    const response = await fetcher(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`DOCUMENT_DOWNLOAD_FAILED_${response.status}`); }
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > 50 * 1024 * 1024) throw new Error('DOCUMENT_TOO_LARGE');
    const chunks = []; let loaded = 0;
    if (response.body) {
      const reader = response.body.getReader();
      // Also cancel a stalled reader if a transport fails to reject on abort.
      const stopReader = () => { void reader.cancel(controller.signal.reason).catch(() => {}); };
      controller.signal.addEventListener('abort', stopReader, { once: true });
      try {
        while (true) {
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          loaded += value.byteLength;
          if (loaded > 50 * 1024 * 1024) throw new Error('DOCUMENT_TOO_LARGE');
          chunks.push(value); touch(); onProgress?.({ loaded, total });
        }
      } finally { controller.signal.removeEventListener('abort', stopReader); reader.releaseLock(); }
    }
    const blob = new Blob(chunks, { type: imagePreview ? 'image/jpeg' : 'application/pdf' });
    const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
    if (imagePreview ? !(header[0] === 255 && header[1] === 216 && header[2] === 255) : !new TextDecoder().decode(header).includes('%PDF-')) throw new Error('DOCUMENT_INVALID_PDF');
    controller.signal.throwIfAborted();
    onProgress?.({ loaded: blob.size, total: blob.size }); finished();
    return blob;
  } finally { clearTimeout(timer); clearTimeout(idleTimer); controller.abort(); signal?.removeEventListener('abort', abort); }
}
