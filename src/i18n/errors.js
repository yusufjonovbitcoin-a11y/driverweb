const ERROR_PATTERNS = [
  [/LOAD_DOCUMENT_STALE/, 'loadTrash.documentStale'],
  [/LOAD_TRASH_CONFLICT/, 'loadTrash.conflict'],
  [/LOAD_TRASH_NOT_FOUND/, 'loadTrash.notFound'],
  [/LOAD_(?:TRASHED|ALREADY_TRASHED|NOT_TRASHED|TRASH_ALREADY_TRASHED|TRASH_NOT_TRASHED)/, 'loadTrash.invalidState'],
  [/LOAD_TRASH_DRIVER|Driver not found or inactive/, 'loadTrash.driverInvalid'],
  [/CHAT_MEDIA_FILE_TOO_LARGE/, 'chat.fileTooLarge'],
  [/CHAT_MEDIA_FILE_EMPTY/, 'chat.mediaFileEmpty'],
  [/CHAT_MEDIA_OUTBOX_FULL/, 'chat.mediaQueueFull'],
  [/CHAT_MEDIA_STORAGE_UNAVAILABLE|QuotaExceededError/, 'chat.mediaStorageUnavailable'],
  [/ASSIGN_FAILED_DRAFT_SAVED/, 'loadImport.assignmentFailedSaved'],
  [/PREVIEW_TICKET_(?:INVALID|EXPIRED_OR_MISMATCHED)/, 'loadImport.previewExpired'],
  [/DOCUMENT_REVIEW_BLOCKED/, 'loadImport.reviewBlocked'],
  [/IMPORT_STILL_PROCESSING|Bu hujjat hozir tahlil qilinmoqda/, 'importReview.stillProcessing'],
  [/IMPORT_STATUS_UNAVAILABLE|IMPORT_RESULT_MISSING/, 'importReview.resultUnavailable'],
  [/PDF_CORRECTION_SOURCE_MISSING/, 'importReview.sourceMismatch'],
  [/PDF_SOURCE_REIMPORT_REQUIRED/, 'importReview.sourceReimport'],
  [/PDF_(?:SOURCE|WORKER|PREPROCESS|OCR|PAGE)/, 'importReview.sourceUnavailable'],
  [/LOAD_NUMBER_EXISTS|loads_company_id_load_number_key/, 'importReview.duplicateLoad'],
  [/Yuk haydovchiga berilgan\. Uning hujjatini avtomatik almashtirib bo.lmaydi\./, 'importReview.duplicateLoad'],
  [/AI_DOCUMENT_TIMEOUT|Signal timed out/, 'importReview.timeout'],
  [/CHAT_RATE_LIMIT/, 'errors.chatRateLimit'],
  [/CHAT_MESSAGE_TOO_LONG/, 'errors.chatMessageTooLong'],
  [/session|jwt|token.*expired/i, 'errors.sessionExpired'],
  [/invalid login|invalid credentials/i, 'errors.invalidCredentials'],
  [/network|fetch failed|failed to fetch/i, 'errors.network'],
  [/Route service environment is incomplete|Google.*(?:HTTP|marshrut)|Zaxira marshrut xizmati/i, 'errors.routeUnavailable'],
  [/koordinatasi topilmadi|Marshrut xizmati masofani qaytarmadi/i, 'errors.routeAddress'],
  [/Could not find the function|schema cache/i, 'errors.backendOutdated'],
  [/permission|not authorized|forbidden/i, 'errors.permission'],
  [/not found/i, 'errors.notFound'],
];

export function localizedError(t, error, fallbackKey = 'errors.generic') {
  const code = error?.code || error?.errorCode;
  if (code && t(`errors.codes.${code}`, { defaultValue: '' })) {
    const translated = t(`errors.codes.${code}`, { ...error?.params, defaultValue: '' });
    if (translated) return translated;
  }
  const message = String(error?.message || '');
  const match = ERROR_PATTERNS.find(([pattern]) => pattern.test(message));
  return t(match?.[1] || fallbackKey);
}
