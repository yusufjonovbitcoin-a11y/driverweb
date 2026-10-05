import { mergeChatMessages } from './chatReliability.js';

export const CHAT_WINDOW_LIMIT = 500;
const PREFIX = 'drivex-chat-outbox:v2:';
const HISTORY_PREFIX = 'drivex-chat-cache:v2:';
const EPOCH_PREFIX = 'drivex-chat-logout:v1:';
const MAX_PENDING = 100;
export const chatAccountKey = (user) => JSON.stringify([user?.id, user?.companyId, user?.roleCode]);
const defaultStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
export const chatLogoutEpoch = (scope, storage = defaultStorage()) => { try { return storage?.getItem(`${EPOCH_PREFIX}${scope}`) || ''; } catch { return ''; } };

// Each pending message has an independent key, so two tabs cannot overwrite a queue.
export class ChatOutbox {
  constructor(scope, storage = defaultStorage(), uuid = () => crypto.randomUUID(), locks = globalThis.navigator?.locks) {
    this.key = `${PREFIX}${scope}`;
    this.scope = scope; this.epochStorage = storage; this.epoch = chatLogoutEpoch(scope, storage);
    this.storage = storage;
    this.uuid = uuid;
    this.inflight = new Map();
    this.rows = new Map();
    this.owned = new Set();
    this.listeners = new Set();
    this.locks = locks;
    this.closed = false;
    this.refresh();
  }
  refresh() {
    if (!this.isCurrent()) { this.closed = true; this.rows.clear(); this.notify(); return; }
    if (!this.storage || this.closed) return;
    try {
      const restored = new Map();
      const expired = [];
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (!key?.startsWith(`${this.key}:`)) continue;
        let row;
        try { row = JSON.parse(this.storage.getItem(key) || 'null'); } catch { expired.push(key); continue; }
        if (row?.client_id && row?.conversation_id && typeof row.body === 'string' && Date.now() - Date.parse(row.created_at) < 7 * 86400000) restored.set(row.client_id, row);
        else expired.push(key);
      }
      expired.forEach((key) => this.storage.removeItem(key));
      this.rows = restored;
    } catch { /* unavailable storage retains memory state */ }
  }
  isCurrent() { return !this.closed && this.epoch === chatLogoutEpoch(this.scope, this.epochStorage); }
  save(row) {
    if (!this.isCurrent()) return;
    this.rows.set(row.client_id, row);
    const key = `${this.key}:${row.client_id}`; const serialized = JSON.stringify(row);
    try {
      this.storage?.setItem(key, serialized);
      // Another tab can log out between the pre-write check and setItem.
      if (!this.isCurrent() && this.storage?.getItem(key) === serialized) this.storage.removeItem(key);
    } catch { this.storage = undefined; /* Keep epochStorage for logout generation checks. */ }
    if (!this.isCurrent()) this.rows.clear();
    this.notify();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const listener of this.listeners) listener(); }
  enqueue(conversationId, senderId, body) {
    if (body.trim().length > 4000) throw new Error('CHAT_MESSAGE_TOO_LONG');
    this.refresh();
    if (!this.isCurrent()) throw new Error('CHAT_ACCOUNT_CHANGED');
    if (this.rows.size >= MAX_PENDING) throw new Error('CHAT_OUTBOX_FULL');
    const row = { id: `pending:${this.uuid()}`, client_id: this.uuid(), conversation_id: conversationId, sender_id: senderId, body: body.trim(), kind: 'text', created_at: new Date().toISOString(), status: 'queued' };
    this.owned.add(row.client_id); this.save(row); return row;
  }
  list(conversationId) { return [...this.rows.values()].filter((row) => !conversationId || row.conversation_id === conversationId).map((row) => ({ ...row, status: !this.canAutoSend(row) && ['queued', 'sending'].includes(row.status) ? 'failed' : row.status })); }
  acknowledge(clientId) { if (!clientId || !this.rows.has(clientId)) return; this.rows.delete(clientId); try { this.storage?.removeItem(`${this.key}:${clientId}`); } catch { /* unavailable */ } this.notify(); }
  canAutoSend(row) { return Boolean(this.locks || this.owned.has(row.client_id)); }
  async send(row, deliver) {
    if (this.inflight.has(row.client_id)) return this.inflight.get(row.client_id);
    const run = async () => {
      this.refresh();
      const current = this.rows.get(row.client_id);
      if (!current || this.closed) return null;
      current.status = 'sending'; this.save(current);
      try {
        const message = await deliver(current);
        this.acknowledge(current.client_id);
        return message;
      } catch (error) {
        // Realtime / another tab may have acknowledged a committed request whose
        // response was lost. Do not resurrect its optimistic bubble as failed.
        this.refresh();
        if (this.rows.has(current.client_id)) { current.status = 'failed'; this.save(current); }
        throw error;
      } finally { this.inflight.delete(current.client_id); }
    };
    const operation = Promise.resolve().then(() => this.locks
      ? this.locks.request(`${this.key}:${row.client_id}`, run)
      : run()).finally(() => this.inflight.delete(row.client_id));
    this.inflight.set(row.client_id, operation);
    return operation;
  }
  clear() { for (const row of this.rows.values()) this.acknowledge(row.client_id); this.closed = true; this.rows.clear(); }
}

export function clearPersistedChatSession(scope, storage = defaultStorage()) {
  try {
    storage?.setItem(`${EPOCH_PREFIX}${scope}`, crypto.randomUUID());
    const keys = [];
    for (let index = 0; index < (storage?.length || 0); index++) {
      const key = storage.key(index);
      if (key === `${HISTORY_PREFIX}${scope}` || key?.startsWith(`${PREFIX}${scope}:`)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
    globalThis.dispatchEvent?.(new CustomEvent('drivex-chat-logout', { detail: scope }));
  } catch { /* unavailable */ }
}

export class ChatSessionCache {
  constructor(scope, { limit = 20, messageLimit = CHAT_WINDOW_LIMIT, storage = defaultStorage() } = {}) {
    this.entries = new Map(); this.limit = limit; this.messageLimit = messageLimit; this.storage = storage; this.key = `${HISTORY_PREFIX}${scope}`; this.closed = false;
    this.scope = scope; this.epoch = chatLogoutEpoch(scope, storage);
    try {
      const cached = JSON.parse(storage?.getItem(this.key) || '[]');
      for (const [driverId, entry] of Array.isArray(cached) ? cached.slice(-5) : []) {
        if (typeof driverId !== 'string' || !Array.isArray(entry?.messages)) continue;
        if (Date.now() - Number(entry.touched || 0) > 7 * 86400000) continue;
        const messages = entry.messages.slice(-100);
        this.entries.set(driverId, { ...entry, messages, versions: new Map(messages.map((row) => [row.id, { revision: Number(row.revision || 0), deleted: false }])) });
      }
    } catch { /* Invalid/private storage starts empty. */ }
  }
  save() {
    if (this.closed || this.epoch !== chatLogoutEpoch(this.scope, this.storage)) { this.close(); return; }
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), 250); this.timer.unref?.(); }
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.closed || this.epoch !== chatLogoutEpoch(this.scope, this.storage)) { this.close(); return; }
    const rows = [...this.entries].slice(-5).map(([id, entry]) => [id, {
      conversationId: entry.conversationId, draft: entry.draft.slice(0, 4000), touched: Date.now(), hasMore: entry.hasMore || entry.messages.length > 100,
      detached: Boolean(entry.detached),
      // Media URLs/auth tokens and location data never enter this store.
      messages: entry.messages.slice(-100).map(({ id: messageId, conversation_id, sender_id, body, kind, created_at, read_at, edited_at, revision, client_id, storage_path, file_name, mime_type, size_bytes, duration_ms }) => ({ id: messageId, conversation_id, sender_id, body, kind, created_at, read_at, edited_at, revision, client_id, storage_path, file_name, mime_type, size_bytes, duration_ms })),
    }]);
    const serialized = JSON.stringify(rows);
    try {
      this.storage?.setItem(this.key, serialized);
      if (this.epoch !== chatLogoutEpoch(this.scope, this.storage)) {
        if (this.storage?.getItem(this.key) === serialized) this.storage.removeItem(this.key);
        this.close();
      }
    } catch { /* Quota exhausted: retain live memory cache. */ }
  }
  setDraft(driverId, draft) { this.get(driverId).draft = draft; this.save(); }
  close() { this.closed = true; clearTimeout(this.timer); this.entries.clear(); }
  get(driverId) {
    let entry = this.entries.get(driverId);
    if (!entry) entry = { conversationId: null, messages: [], draft: '', scroll: null, hasMore: false, versions: new Map(), touched: 0 };
    this.entries.delete(driverId); this.entries.set(driverId, entry);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    return entry;
  }
  merge(driverId, incoming, { older = false, replaceWindow = false } = {}) {
    const entry = this.get(driverId);
    if (replaceWindow) { entry.messages = []; entry.detached = false; }
    const accepted = [];
    for (const row of incoming) {
      if (!row?.id) continue;
      const previous = entry.versions.get(row.id);
      // A tombstone is terminal; a late signed URL / old INSERT cannot resurrect it.
      if (previous?.deleted || (previous?.revision && Number(row.revision || 0) < previous.revision)) continue;
      if (entry.detached && !older && !row.deleted_at && !previous && row.created_at > entry.messages.at(-1)?.created_at) continue;
      entry.versions.set(row.id, { revision: Number(row.revision || 0), deleted: Boolean(row.deleted_at) });
      accepted.push(row);
    }
    const merged = mergeChatMessages(entry.messages, accepted);
    entry.messages = older ? merged.slice(0, this.messageLimit) : merged.slice(-this.messageLimit);
    if (older && merged.length > this.messageLimit) entry.detached = true;
    if (merged.length > this.messageLimit && !older) entry.hasMore = true;
    // Keep tombstones for this bounded conversation; evict old non-visible metadata.
    const visible = new Set(entry.messages.map((row) => row.id));
    for (const [id, version] of entry.versions) if (!visible.has(id) && !version.deleted) entry.versions.delete(id);
    while (entry.versions.size > this.messageLimit * 4) entry.versions.delete(entry.versions.keys().next().value);
    entry.touched = Date.now();
    this.save();
    return entry.messages;
  }
  patch(driverId, ids, patch) {
    const entry = this.get(driverId); const selected = new Set(ids);
    entry.messages = entry.messages.map((row) => selected.has(row.id) ? { ...row, ...patch } : row);
    this.save();
    return entry.messages;
  }
  isDeleted(driverId, id) { return Boolean(this.get(driverId).versions.get(id)?.deleted); }
}
