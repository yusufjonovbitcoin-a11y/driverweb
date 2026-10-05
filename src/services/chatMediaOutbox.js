import { chatLogoutEpoch } from './chatSession.js';

export const MEDIA_FILE_LIMIT = 50 * 1024 * 1024;
export const MEDIA_QUEUE_LIMIT = 200 * 1024 * 1024;
export const MEDIA_QUEUE_COUNT = 100;
const STORE = 'pending';
const EPOCHS = 'epochs';
const MAX_AGE = 7 * 86400000;
export function validateMediaQueue(rows, row) {
  if (row.blob.size === 0) throw new Error('CHAT_MEDIA_FILE_EMPTY');
  if (row.blob.size > MEDIA_FILE_LIMIT) throw new Error('CHAT_MEDIA_FILE_TOO_LARGE');
  if (rows.length >= MEDIA_QUEUE_COUNT || rows.reduce((sum, entry) => sum + entry.blob.size, 0) + row.blob.size > MEDIA_QUEUE_LIMIT) throw new Error('CHAT_MEDIA_OUTBOX_FULL');
}

// The read/write transaction makes the global disk budget atomic across tabs.
export class IndexedDbMediaStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  open() {
    if (!this.database) this.database = new Promise((resolve, reject) => {
      if (!this.indexedDB) { reject(new Error('CHAT_MEDIA_STORAGE_UNAVAILABLE')); return; }
      const request = this.indexedDB.open('drivex-chat-media-outbox-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'key' }); request.result.createObjectStore(EPOCHS); };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(new Error('CHAT_MEDIA_STORAGE_UNAVAILABLE', { cause: request.error }));
      request.onblocked = () => reject(new Error('CHAT_MEDIA_STORAGE_UNAVAILABLE'));
    });
    return this.database;
  }
  async transaction(mode, operate) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE, EPOCHS], mode);
      let result; let failure;
      const fail = (error) => { failure = error; transaction.abort(); };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => {};
      transaction.onabort = () => reject(failure || new Error('CHAT_MEDIA_STORAGE_UNAVAILABLE', { cause: transaction.error }));
      operate(transaction.objectStore(STORE), (value) => { result = value; }, fail, transaction.objectStore(EPOCHS));
    });
  }
  list(scope) {
    return this.transaction('readwrite', (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = [];
        for (const row of request.result) {
          if (Date.now() - Date.parse(row.created_at) >= MAX_AGE) store.delete(row.key);
          else if (row.scope === scope) rows.push(row);
        }
        done(rows);
      };
    });
  }
  get(key) { return this.transaction('readonly', (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result || null); }); }
  epoch(scope) { return this.transaction('readonly', (_store, done, _fail, epochs) => { const request = epochs.get(scope); request.onsuccess = () => done(request.result || ''); }); }
  add(row) {
    return this.transaction('readwrite', (store, done, fail, epochs) => {
      const generation = epochs.get(row.scope);
      generation.onsuccess = () => {
      if ((generation.result || '') !== row.storage_epoch) { fail(new Error('CHAT_ACCOUNT_CHANGED')); return; }
      const request = store.getAll();
      request.onsuccess = () => {
        const active = request.result.filter((entry) => Date.now() - Date.parse(entry.created_at) < MAX_AGE);
        for (const entry of request.result) if (!active.includes(entry)) store.delete(entry.key);
        try { validateMediaQueue(active, row); } catch (error) { fail(error); return; }
        store.add(row); done(row);
      };
      };
    });
  }
  update(key, patch) {
    return this.transaction('readwrite', (store, done) => {
      const request = store.get(key);
      request.onsuccess = () => { if (!request.result) { done(null); return; } const row = { ...request.result, ...patch }; store.put(row); done(row); };
    });
  }
  remove(key) { return this.transaction('readwrite', (store) => { store.delete(key); }); }
  clear(scope) { return this.transaction('readwrite', (store, _done, _fail, epochs) => { epochs.put(crypto.randomUUID(), scope); const request = store.getAll(); request.onsuccess = () => { for (const row of request.result) if (row.scope === scope) store.delete(row.key); }; }); }
}

export class ChatMediaOutbox {
  constructor(scope, { store = new IndexedDbMediaStore(), uuid = () => crypto.randomUUID(), locks = globalThis.navigator?.locks, epoch = () => chatLogoutEpoch(scope) } = {}) {
    this.scope = scope; this.store = store; this.uuid = uuid; this.locks = locks;
    this.rows = new Map(); this.inflight = new Map(); this.controllers = new Map(); this.cancelled = new Set(); this.listeners = new Set(); this.owned = new Set(); this.closed = false;
    this.readEpoch = epoch; this.epoch = epoch();
  }
  isCurrent() { return !this.closed && this.epoch === this.readEpoch(); }
  async ready() { if (!this.isCurrent()) throw new Error('CHAT_ACCOUNT_CHANGED'); if (!this.storageEpoch) this.storageEpoch = this.store.epoch(this.scope); return this.storageEpoch; }
  async restore() { await this.ready(); const rows = await this.store.list(this.scope); if (!this.isCurrent()) return; this.rows = new Map(rows.map((row) => [row.client_id, row])); this.notify(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const listener of this.listeners) listener(); }
  list() { return [...this.rows.values()].map(({ blob: _blob, key: _key, scope: _scope, ...row }) => ({ ...row, status: !this.owned.has(row.client_id) && ['queued', 'sending'].includes(row.status) ? 'failed' : row.status })); }
  async enqueue({ file, conversationId, senderId, companyId, durationMs = null }) {
    const storageEpoch = await this.ready();
    if (!(file instanceof Blob) || file.size === 0) throw new Error('CHAT_MEDIA_FILE_EMPTY');
    if (file.size > MEDIA_FILE_LIMIT) throw new Error('CHAT_MEDIA_FILE_TOO_LARGE');
    const clientId = this.uuid();
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
    const row = { key: `${this.scope}:${clientId}`, scope: this.scope, storage_epoch: storageEpoch, id: `pending-media:${clientId}`, client_id: clientId, company_id: companyId, conversation_id: conversationId, sender_id: senderId, created_at: new Date().toISOString(), kind, file_name: file.name || 'attachment', mime_type: file.type, size_bytes: file.size, duration_ms: durationMs, status: 'queued', blob: file };
    await this.store.add(row);
    if (!this.isCurrent()) { await this.store.remove(row.key); throw new Error('CHAT_ACCOUNT_CHANGED'); }
    this.owned.add(clientId); this.rows.set(clientId, row); this.notify(); return row;
  }
  async acknowledge(clientId) { if (!clientId) return; await this.store.remove(`${this.scope}:${clientId}`); this.rows.delete(clientId); this.notify(); }
  send(row, deliver) {
    if (this.inflight.has(row.client_id)) return this.inflight.get(row.client_id);
    this.cancelled.delete(row.client_id);
    const run = async () => {
      const current = await this.store.get(`${this.scope}:${row.client_id}`);
      if (!current || !this.isCurrent()) return null;
      const controller = new AbortController(); this.controllers.set(row.client_id, controller); this.owned.add(row.client_id);
      const sending = await this.store.update(current.key, { status: 'sending' });
      if (!sending || !this.isCurrent()) { this.controllers.delete(row.client_id); return null; }
      this.rows.set(row.client_id, sending); this.notify();
      if (this.cancelled.has(row.client_id)) controller.abort();
      try {
        const message = await deliver(current, controller.signal);
        await this.acknowledge(row.client_id); return message;
      } catch (error) {
        if (this.isCurrent()) { const failed = await this.store.update(current.key, { status: 'failed' }); if (failed) this.rows.set(row.client_id, failed); else this.rows.delete(row.client_id); this.notify(); }
        throw error;
      } finally { this.controllers.delete(row.client_id); }
    };
    const operation = Promise.resolve().then(() => this.locks ? this.locks.request(`chat-media:${this.scope}:${row.client_id}`, run) : run())
      .finally(() => { this.inflight.delete(row.client_id); this.controllers.delete(row.client_id); this.cancelled.delete(row.client_id); });
    this.inflight.set(row.client_id, operation); return operation;
  }
  cancel(clientId) { this.cancelled.add(clientId); this.controllers.get(clientId)?.abort(); }
  close() { this.closed = true; for (const controller of this.controllers.values()) controller.abort(); this.rows.clear(); this.notify(); }
  async clear() { this.close(); await this.store.clear(this.scope); }
}

export async function clearPersistedChatMedia(scope) { await new IndexedDbMediaStore().clear(scope); }
