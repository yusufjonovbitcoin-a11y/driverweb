const ERROR_PATTERNS = [
  [/session|jwt|token.*expired/i, 'errors.sessionExpired'],
  [/invalid login|invalid credentials/i, 'errors.invalidCredentials'],
  [/network|fetch failed|failed to fetch/i, 'errors.network'],
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
