import { requireSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase';
import {
  isCloudinaryReference,
} from './cloudinaryMediaErrors';
import { cachedSignedMediaUrl, invalidateSignedMediaUrl } from './mediaUrlCache';
import { requestMediaJson, uploadMediaRequest } from './mediaRequestTransport';

export {
  CloudinaryMediaError,
  isCloudinaryReference,
  isMissingCloudinaryMediaError,
} from './cloudinaryMediaErrors';

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
  return requestMediaJson(`${supabaseUrl}/functions/v1/cloudinary-media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    },
    body: multipart ? body : JSON.stringify(body),
  });
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
  return uploadMediaRequest({
    url: `${supabaseUrl}/functions/v1/cloudinary-media`,
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    body: form, onProgress, signal,
  });
}

export async function cloudinarySignedUrl(reference) {
  if (!isCloudinaryReference(reference)) return null;
  return cachedSignedMediaUrl(requireSupabase(), reference, async () => {
    const result = await request({ action: 'signedUrl', reference });
    return result.url || null;
  });
}

export async function deleteCloudinaryMedia(reference) {
  if (!isCloudinaryReference(reference)) return false;
  await request({ action: 'delete', reference });
  invalidateSignedMediaUrl(requireSupabase(), reference);
  return true;
}
