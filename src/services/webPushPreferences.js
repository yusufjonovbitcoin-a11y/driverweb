export const emptyPushPreferences = Object.freeze({ calls: false, messages: false });
export const pushPreferencesKey = (id) => `tfleets.push.preferences.v1.${id}`;
export const legacyPushPreferenceKey = (id) => `tfleest.push.enabled.${id}`;
export const pushPreferencesEvent = 'tfleets-push-preferences';
export const normalizePushPreferences = (value) => ({ calls: value?.calls === true, messages: value?.messages === true });
export const hasPushCategory = (value) => Boolean(value?.calls || value?.messages);
export async function withPushDeadline(operation, milliseconds = 20_000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('workerTimeout')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
export function pushFailureReason(error, fallback = 'error') {
  const safe = ['denied', 'unsupported', 'off', 'signedOut', 'workerTimeout', 'workerFailed',
    'workerProtocol', 'registrationFailed', 'disableFailed', 'testFailed'];
  if (safe.includes(error?.message)) return error.message;
  if (typeof error?.code === 'string' && error.code.startsWith('messaging/')) return 'registrationFailed';
  return fallback;
}
export function readPushPreferences(id, read) {
  if (!id) return { ...emptyPushPreferences };
  const stored = read(pushPreferencesKey(id));
  if (stored !== null) {
    try { return normalizePushPreferences(JSON.parse(stored)); } catch { return { ...emptyPushPreferences }; }
  }
  // Migration is persisted only after a successful endpoint registration.
  const legacy = read(legacyPushPreferenceKey(id)) === 'true';
  return { calls: legacy, messages: legacy };
}
