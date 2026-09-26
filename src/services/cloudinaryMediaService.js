import { requireSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase';

const CLOUDINARY_PREFIX = 'cloudinary:';

export function isCloudinaryReference(value) {
  return typeof value === 'string' && value.startsWith(CLOUDINARY_PREFIX);
}

async function accessToken() {
  const client = requireSupabase();
  let { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.expires_at * 1000 <= Date.now() + 60_000) {
    ({ data, error } = await client.auth.refreshSession());
    if (error) throw error;
  }
  if (!data.session?.access_token) throw new Error('Sessiya tugagan. Hisobga qayta kiring.');
  return data.session.access_token;
}

async function request(body, { multipart = false } = {}) {
  const token = await accessToken();
  const response = await fetch(`${supabaseUrl}/functions/v1/cloudinary-media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    },
    body: multipart ? body : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Media xatosi (${response.status})`);
  return payload;
}

export async function uploadCloudinaryMedia({
  file,
  scope,
  contextId = null,
  onProgress,
  signal,
}) {
  const token = await accessToken();
  const form = new FormData();
  form.set('file', file, file.name);
  form.set('scope', scope);
  if (contextId) form.set('contextId', contextId);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${supabaseUrl}/functions/v1/cloudinary-media`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error('Media serveriga ulanib bo‘lmadi.'));
    xhr.onabort = () => reject(new DOMException('Upload bekor qilindi.', 'AbortError'));
    xhr.onload = () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch { /* handled below */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(payload.error || `Media xatosi (${xhr.status})`));
        return;
      }
      onProgress?.(1);
      resolve(payload);
    };
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    xhr.send(form);
  });
}

export async function cloudinarySignedUrl(reference, expiresIn = 3600) {
  if (!isCloudinaryReference(reference)) return null;
  const result = await request({ action: 'signedUrl', reference, expiresIn });
  return result.url || null;
}

export async function deleteCloudinaryMedia(reference) {
  if (!isCloudinaryReference(reference)) return false;
  await request({ action: 'delete', reference });
  return true;
}
