// Transport primitives are framework-independent so failure/reconnect paths can be tested.
export async function reconcileHistory(fetchPage, oldest, isCurrent = () => true, maxMessages = 500) {
  let before = null;
  const rows = [];
  let page;
  do {
    page = await fetchPage(before);
    if (!isCurrent()) return null;
    rows.push(...page.messages);
    before = page.cursor;
    if (!before) break;
  } while (rows.length < maxMessages && page.hasMore && oldest && (
    before.createdAt > oldest.createdAt || (before.createdAt === oldest.createdAt && before.id > oldest.id)
  ));
  return { messages: rows, hasMore: page.hasMore, cursor: before, truncated: rows.length >= maxMessages && page.hasMore };
}

export function createBatchedNotifier(delay = 200) {
  const listeners = new Set();
  let timer;
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify() {
      if (timer) return;
      timer = setTimeout(() => { timer = null; for (const listener of listeners) listener(); }, delay);
    },
    clear() { clearTimeout(timer); timer = null; },
  };
}

export class PendingSends {
  constructor(storage, uuid = () => crypto.randomUUID()) { this.storage = storage; this.uuid = uuid; this.memory = new Map(); }
  get(key) {
    let entry = this.memory.get(key);
    try { entry ||= JSON.parse(this.storage?.getItem(key) || 'null'); } catch { /* private browsing */ }
    if (!entry || Date.now() - entry.created > 86400000) entry = { id: this.uuid(), created: Date.now() };
    this.memory.set(key, entry);
    try { this.storage?.setItem(key, JSON.stringify(entry)); } catch { /* in-memory fallback */ }
    return entry.id;
  }
  complete(key) { this.memory.delete(key); try { this.storage?.removeItem(key); } catch { /* unavailable storage */ } }
}

export class MediaSends {
  constructor(uuid = () => crypto.randomUUID()) { this.pending = new WeakMap(); this.uuid = uuid; }
  async send(file, owner, upload, commit) {
    let operation = this.pending.get(file);
    if (!operation || operation.owner !== owner) {
      operation = { owner, id: this.uuid(), reference: null };
      this.pending.set(file, operation);
    }
    if (!operation.reference) operation.reference = (await upload(operation.id)).reference;
    const message = await commit(operation.id, operation.reference);
    this.pending.delete(file);
    return message;
  }
}
