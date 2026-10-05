import { requireSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase';
import { uploadMediaRequest } from './mediaRequestTransport';

// The object key contains a stable client operation ID. A retry never overwrites
// an object; a conflict only acknowledges the same already-uploaded operation.
export async function uploadChatMedia({ file, path, signal, onProgress }) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > 50 * 1024 * 1024) {
    throw new Error('Chat files must be between 1 byte and 50 MB.');
  }
  if (!path || path.includes('\0') || path.startsWith('/') || path.split('/').some((segment) => !segment || segment === '..' || segment === '.')) {
    throw new Error('Invalid chat media path.');
  }
  const client = requireSupabase();
  let { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.expires_at * 1000 <= Date.now() + 60_000) {
    ({ data, error } = await client.auth.refreshSession());
    if (error) throw error;
  }
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expired. Sign in again.');
  signal?.throwIfAborted();
  // New uploads alone opt into expiry; the server never backfills old files.
  const registration = await client.rpc('register_chat_media_upload', { target_path: path });
  if (registration.error) throw registration.error;
  signal?.throwIfAborted();
  try {
    await uploadMediaRequest({
      url: `${supabaseUrl}/storage/v1/object/chat-media/${path.split('/').map(encodeURIComponent).join('/')}`,
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey,
        'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': 'private, max-age=0' },
      body: file, onProgress, signal,
    });
  } catch (error) {
    const duplicate = [400, 409].includes(error.status) &&
      (['Duplicate', 'ResourceAlreadyExists', 'KeyAlreadyExists'].includes(error.code) ||
        /^(?:the resource|asset) already exists\.?$/i.test(error.message));
    if (!duplicate) throw error;
  }
  return { reference: path, storagePath: path, fileName: file.name, mimeType: file.type, sizeBytes: file.size };
}
