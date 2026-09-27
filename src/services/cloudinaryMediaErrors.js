const CLOUDINARY_PREFIX = 'cloudinary:';

export class CloudinaryMediaError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = 'CloudinaryMediaError';
    this.status = status;
    this.code = code;
  }
}

export function isCloudinaryReference(value) {
  return typeof value === 'string' && value.startsWith(CLOUDINARY_PREFIX);
}

export function isMissingCloudinaryMediaError(error) {
  return error instanceof CloudinaryMediaError
    && error.status === 404
    && error.code === 'MEDIA_NOT_FOUND';
}
