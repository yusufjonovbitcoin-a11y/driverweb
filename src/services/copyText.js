export async function copyText(value, environment = globalThis) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('COPY_TEXT_EMPTY');
  try {
    if (environment.navigator?.clipboard?.writeText) {
      await environment.navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Some embedded browsers deny the modern API. Keep the user-click fallback.
  }
  const document = environment.document;
  if (!document?.body || typeof document.execCommand !== 'function') throw new Error('COPY_UNAVAILABLE');
  const previousFocus = document.activeElement;
  const input = document.createElement('textarea');
  input.value = value;
  input.readOnly = true;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('COPY_UNAVAILABLE');
  } finally {
    input.remove();
    previousFocus?.focus?.({ preventScroll: true });
  }
}
