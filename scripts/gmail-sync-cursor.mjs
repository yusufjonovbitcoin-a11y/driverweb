export function normalizeMessageLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 25;
}

// Advance through the oldest pending UIDs first. Taking the newest page and
// committing its maximum UID would permanently skip older pending messages.
export function selectPendingUids(candidates, lastUid, limit) {
  return [...new Set(candidates.map(Number))]
    .filter((uid) => Number.isSafeInteger(uid) && uid > lastUid)
    .sort((left, right) => left - right)
    .slice(0, normalizeMessageLimit(limit));
}
