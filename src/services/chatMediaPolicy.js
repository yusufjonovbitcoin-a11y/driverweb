// Keep this allowlist aligned with the private chat-media bucket. MIME parameters
// from MediaRecorder are normalized before Storage validates Content-Type.
export const CHAT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const extensions = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime',
  aac: 'audio/aac', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  pdf: 'application/pdf',
};
const allowed = new Set([...Object.values(extensions), 'audio/m4a', 'audio/webm']);
export const CHAT_MEDIA_ACCEPT = [...allowed, ...Object.keys(extensions).map(ext => `.${ext}`)].join(',');
export function chatMediaType(file) {
  const declared = String(file.type || '').split(';')[0].trim().toLowerCase();
  const type = declared === 'audio/x-m4a' ? 'audio/mp4' : declared;
  if (allowed.has(type)) return type;
  if (!type || type === 'application/octet-stream') {
    const inferred = extensions[String(file.name || '').split('.').at(-1).toLowerCase()];
    if (inferred) return inferred;
  }
  throw new Error('CHAT_MEDIA_UNSUPPORTED_TYPE');
}
export function validateChatMedia(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error('CHAT_MEDIA_FILE_EMPTY');
  if (file.size > CHAT_MEDIA_MAX_BYTES) throw new Error('CHAT_MEDIA_FILE_TOO_LARGE');
  return chatMediaType(file);
}
export function normalizeChatMedia(file) {
  const type = validateChatMedia(file);
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}
