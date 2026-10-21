export function chatMediaRefreshDelay(url, resolvedAt, now = Date.now()) {
  let expiry;
  try { expiry = Number(new URL(url).searchParams.get('expires_at')) * 1000; } catch { /* use conservative bound */ }
  if (!Number.isFinite(expiry) || expiry <= 0) expiry = Number(resolvedAt) + 15 * 60_000;
  if (!Number.isFinite(expiry)) return 0;
  return Math.max(0, expiry - now - 60_000);
}
