import { requireSupabase } from '../lib/supabase';
import { uploadCloudinaryMedia } from './cloudinaryMediaService';
import { createStaffDocumentManager, fetchStaffLoadDocumentContext } from './staffLoadDocuments.js';

export const makeStaffDocumentManager = ownerId => createStaffDocumentManager({
  client: requireSupabase(), ownerId, uploadMedia: uploadCloudinaryMedia,
});

export async function loadStaffDocumentContext(loadId, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20_000);
  try {
    return await fetchStaffLoadDocumentContext(requireSupabase(), loadId, controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
