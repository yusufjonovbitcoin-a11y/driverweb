export const MAX_LOAD_IMPORT_BYTES = 20 * 1024 * 1024;

const allowedExtensions = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
};

export function loadImportFileError(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return 'fileRequired';
  if (file.size > MAX_LOAD_IMPORT_BYTES) return 'fileTooLarge';
  const extensions = allowedExtensions[file.type] || [];
  if (!extensions.some((extension) => file.name?.toLowerCase().endsWith(extension))) {
    return 'fileRequired';
  }
  return null;
}
