import { requireSupabase } from '../lib/supabase';
import {
  cloudinarySignedUrl,
  deleteCloudinaryMedia,
  isCloudinaryReference,
} from './cloudinaryMediaService';
import { buildChatCursor, chatIceServers } from './chatReliability';
import { createBatchedNotifier, MediaSends, PendingSends, reconcileHistory } from './chatTransport';
import { createChatSubscription } from './chatSubscription';
import { invalidateSignedMediaUrl } from './mediaUrlCache';
import { uploadChatMedia } from './chatStorageService';

const bucket = 'chat-media';
let sessionStorage;
try { sessionStorage = globalThis.sessionStorage; } catch { /* private browsing */ }
const pendingSends = new PendingSends(sessionStorage);
const pendingMedia = new MediaSends();
const mediaUrls = new Map();
const changes = createBatchedNotifier();
let unreadRequest = null;
let changeChannel = null;
let changeListeners = 0;
let previewCache = null;
let previewRequest = null;
let previewGeneration = 0;

function actorKey(client) { return client.auth.getSession().then(({ data }) => data.session?.user?.id || 'anonymous'); }

function subscribeChanges(callback) {
  const client = requireSupabase();
  const off = changes.subscribe(callback);
  changeListeners += 1;
  if (!changeChannel) {
    const notify = () => { previewGeneration++; previewCache = null; changes.notify(); };
    changeChannel = client.channel('chat-summary-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, notify)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, notify)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_read_preferences' }, notify)
      .subscribe((status) => { if (status === 'SUBSCRIBED') notify(); });
  }
  return () => {
    off(); changeListeners -= 1;
    if (!changeListeners && changeChannel) { client.removeChannel(changeChannel); changeChannel = null; changes.clear(); mediaUrls.clear(); previewCache = null; previewGeneration++; }
  };
}

function assertNoError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function openChat(driverId) {
  const client = requireSupabase();
  const result = await client.rpc('open_direct_chat', { target_user_id: driverId });
  return assertNoError(result);
}

async function withMediaUrl(client, message) {
  if (!message.storage_path || message.deleted_at) return message;
  const key = `${await actorKey(client)}:${message.storage_path}`;
  const cached = mediaUrls.get(key);
  if (cached && cached.until > Date.now()) {
    try { return { ...message, mediaUrl: await cached.promise }; }
    catch (error) { return { ...message, mediaError: error.message }; }
  }
  const promise = resolveMediaUrl(client, message);
  mediaUrls.set(key, { promise, until: Date.now() + 5 * 60_000 });
  if (mediaUrls.size > 300) mediaUrls.delete(mediaUrls.keys().next().value);
  try { return { ...message, mediaUrl: await promise }; }
  catch (error) { mediaUrls.delete(key); return { ...message, mediaError: error.message }; }
}

async function resolveMediaUrl(client, message) {
  if (isCloudinaryReference(message.storage_path)) {
    return cloudinarySignedUrl(message.storage_path);
  }
  const { data, error } = await client.storage.from(bucket).createSignedUrl(message.storage_path, 3600);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function refreshChatMessageMedia(message) {
  const client = requireSupabase();
  mediaUrls.delete(`${await actorKey(client)}:${message.storage_path}`);
  if (isCloudinaryReference(message.storage_path)) {
    invalidateSignedMediaUrl(client, message.storage_path);
  }
  return withMediaUrl(client, message);
}

export async function hydrateChatMessageMedia(message) {
  return withMediaUrl(requireSupabase(), message);
}

export async function syncChatHistory(conversationId, oldest, isCurrent) {
  const client = requireSupabase();
  return reconcileHistory(async (before) => {
    const rows = assertNoError(await client.rpc('get_chat_sync_page', {
      target_conversation_id: conversationId, before_created_at: before?.createdAt || null,
      before_message_id: before?.id || null, requested_page_size: 100,
    })) || [];
    return { messages: rows,
      cursor: buildChatCursor(rows), hasMore: rows.length === 100 };
  }, oldest, isCurrent);
}

export async function searchChatMessages(conversationId, search, kind, before = null) {
  const client = requireSupabase();
  const rows = assertNoError(await client.rpc('search_chat_messages', {
    target_conversation_id: conversationId, search_text: search.trim().slice(0, 200), media_kind: kind,
    before_created_at: before?.createdAt || null, before_message_id: before?.id || null,
  })) || [];
  return { messages: [...rows].reverse(), hasMore: rows.length === 50, cursor: buildChatCursor(rows) };
}

export async function fetchChatMediaCounts(conversationId) {
  return assertNoError(await requireSupabase().rpc('get_chat_media_counts', { target_conversation_id: conversationId }));
}

export async function fetchChatMessages(conversationId, { before = null, pageSize = 50 } = {}) {
  const client = requireSupabase();
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 100);
  const result = await client.rpc('get_chat_messages_page', {
    target_conversation_id: conversationId,
    before_created_at: before?.createdAt || null,
    before_message_id: before?.id || null,
    requested_page_size: safePageSize,
  });
  const rows = assertNoError(result) || [];
  return {
    messages: [...rows].reverse(),
    hasMore: rows.length === safePageSize,
    cursor: buildChatCursor(rows),
  };
}

export async function sendTextMessage(conversationId, text, { clientId, senderId } = {}) {
  const client = requireSupabase();
  const actor = await actorKey(client);
  if (senderId && actor !== senderId) throw new Error('CHAT_ACCOUNT_CHANGED');
  if (text.trim().length > 4000) throw new Error('CHAT_MESSAGE_TOO_LONG');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = `chat-send:v1:${actor}:${conversationId}:${hash}`;
  const result = await client.rpc('send_chat_message', {
    conversation_id: conversationId,
    message_kind: 'text',
    message_body: text.trim(),
    message_client_id: clientId || pendingSends.get(key),
  });
  const message = assertNoError(result);
  pendingSends.complete(key);
  changes.notify();
  return message;
}

export async function editChatMessage(messageId, text) {
  const client = requireSupabase();
  const result = await client.rpc('edit_chat_message', {
    target_message_id: messageId,
    new_body: text.trim(),
  });
  return assertNoError(result);
}

function fileKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

export async function sendMediaMessage({
  conversationId,
  companyId,
  file,
  durationMs = null,
  clientId,
  senderId,
  onProgress,
  signal,
}) {
  const client = requireSupabase();
  if (!companyId) throw new Error('CHAT_COMPANY_REQUIRED');
  const actor = await actorKey(client);
  if (senderId && actor !== senderId) throw new Error('CHAT_ACCOUNT_CHANGED');
  const owner = `${actor}:${conversationId}`;
  const upload = (operationId) => uploadChatMedia({
    file,
    path: `${companyId}/${conversationId}/${operationId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'attachment'}`,
    onProgress,
    signal,
  });
  const commit = async (operationId, path) => {
    signal?.throwIfAborted();
    const result = await client.rpc('send_chat_message', {
      conversation_id: conversationId,
      message_kind: fileKind(file),
      message_body: null,
      media_storage_path: path,
      media_file_name: file.name,
      media_mime_type: file.type || 'application/octet-stream',
      media_size_bytes: file.size,
      media_duration_ms: durationMs,
      message_client_id: operationId,
    });
    return assertNoError(result);
  };
  const saved = clientId ? await commit(clientId, (await upload(clientId)).reference) : await pendingMedia.send(file, owner, upload, commit);
  changes.notify();
  return saved;
  // An ambiguous transport error MUST NOT delete an asset already referenced by a committed message.
}

export async function markChatRead(conversationId, messageIds) {
  if (!messageIds?.length) return 0;
  const client = requireSupabase();
  const result = await client.rpc('mark_chat_messages_read', { target_conversation_id: conversationId, message_ids: messageIds.slice(0, 100) });
  const count = assertNoError(result);
  if (count) changes.notify();
  return count;
}

export async function markChatUnread(conversationId) {
  const client = requireSupabase();
  const result = await client.rpc('mark_chat_unread', { target_conversation_id: conversationId });
  return assertNoError(result);
}

export async function clearChatUnread(conversationId) {
  const result = await requireSupabase().rpc('clear_chat_unread', { target_conversation_id: conversationId });
  assertNoError(result);
  changes.notify();
}

export async function deleteChatMessage(message) {
  const client = requireSupabase();
  const result = await client.rpc('delete_chat_message', {
    target_message_id: message.id,
  });
  const storagePath = assertNoError(result);
  // New servers queue cleanup and return null; retain compatibility until rollout.
  if (storagePath) {
    if (isCloudinaryReference(storagePath)) {
      await deleteCloudinaryMedia(storagePath);
    } else {
      await client.storage.from(bucket).remove([storagePath]);
    }
  }
}

export async function fetchUnreadChatCount() {
  const client = requireSupabase();
  const result = await client.rpc('get_unread_chat_count');
  return Number(assertNoError(result) || 0);
}

export async function fetchUnreadChatCountsByDriver() {
  const client = requireSupabase();
  const actor = await actorKey(client);
  if (!unreadRequest || unreadRequest.actor !== actor) {
    const promise = client.rpc('get_chat_unread_summary').then((result) =>
      Object.fromEntries((assertNoError(result) || []).map((row) => [row.driver_id, Number(row.unread_count)])));
    const request = { actor, promise };
    unreadRequest = request;
    promise.finally(() => { if (unreadRequest === request) unreadRequest = null; }).catch(() => {});
  }
  return unreadRequest.promise;
}

export async function fetchChatPreviews() {
  const client = requireSupabase();
  const actor = await actorKey(client);
  if (previewCache?.actor === actor && Date.now() - previewCache.at < 30_000) return previewCache.rows;
  if (previewRequest?.actor === actor) return previewRequest.promise;
  const generation = previewGeneration;
  const promise = (async () => {
  const result = await client
    .from('chat_conversations')
    .select('id, dispatcher_id, driver_id, chat_messages!left(id, sender_id, kind, body, file_name, read_at, created_at, deleted_at)')
    .is('chat_messages.deleted_at', null)
    .order('last_message_at', { ascending: false })
    .order('created_at', { referencedTable: 'chat_messages', ascending: false })
    .order('id', { referencedTable: 'chat_messages', ascending: false })
    .limit(1, { referencedTable: 'chat_messages' });
  const rows = assertNoError(result) || [];
  if (generation === previewGeneration) previewCache = { actor, at: Date.now(), rows };
  return rows;
  })();
  const request = { actor, promise };
  previewRequest = request;
  try { return await promise; }
  finally { if (previewRequest === request) previewRequest = null; }
}

export function subscribeChatPreviews(onChange) {
  return subscribeChanges(onChange);
}

export function subscribeChat({ conversationId, onMessage, onMessageUpdated, onStatus, onReconnect }) {
  return createChatSubscription(requireSupabase(), { conversationId, onMessage, onMessageUpdated, onStatus, onReconnect });
}

export function subscribeCalls({ onCall, onSignal, onReconnect }) {
  const client = requireSupabase();
  const channel = client
    .channel(`chat-calls:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'chat_calls',
    }, ({ new: call }) => onCall?.(call))
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_call_signals',
    }, ({ new: signal }) => onSignal?.(signal))
    .subscribe((status) => { if (status === 'SUBSCRIBED') onReconnect?.(); });
  return () => client.removeChannel(channel);
}

export async function fetchRingingCalls() {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_incoming_chat_calls');
  if (error) throw error;
  return data || [];
}

export function subscribeUnreadChats(onChange) {
  return subscribeChanges(onChange);
}

export async function startCall(conversationId, kind) {
  const client = requireSupabase();
  return assertNoError(await client.rpc('start_chat_call', {
    conversation_id: conversationId,
    call_kind: kind,
  }));
}

export async function respondCall(callId, action) {
  const client = requireSupabase();
  return assertNoError(await client.rpc('respond_chat_call', { call_id: callId, action }));
}

export async function heartbeatCall(callId) {
  const client = requireSupabase();
  return assertNoError(await client.rpc('heartbeat_chat_call', {
    target_call_id: callId,
  }));
}

let cachedRtcIceServers = null;
let cachedRtcIceServersUntil = 0;
let rtcIceServersRequest = null;

export async function fetchRtcIceServers() {
  const now = Date.now();
  if (cachedRtcIceServers && now < cachedRtcIceServersUntil) return cachedRtcIceServers;
  if (rtcIceServersRequest) return rtcIceServersRequest;

  rtcIceServersRequest = (async () => {
    const client = requireSupabase();
    const { data, error } = await client.functions.invoke('turn-credentials', { body: {} });
    if (error || !Array.isArray(data?.iceServers)) return chatIceServers();
    const servers = data.iceServers.filter((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.length > 0 && urls.every((url) => /^(stun|turns?):/i.test(String(url)));
    });
    if (servers.length < 2) return chatIceServers();
    const providerExpiry = Number(data.expiresAt) * 1000;
    cachedRtcIceServers = servers;
    cachedRtcIceServersUntil = Number.isFinite(providerExpiry)
      ? Math.max(now + 60_000, providerExpiry - 60_000)
      : now + 50 * 60_000;
    return servers;
  })();

  try {
    return await rtcIceServersRequest;
  } finally {
    rtcIceServersRequest = null;
  }
}

export async function publishSignal(callId, kind, payload) {
  const client = requireSupabase();
  return assertNoError(await client.rpc('publish_chat_signal', {
    call_id: callId,
    signal_kind: kind,
    signal_payload: payload,
  }));
}

export async function fetchCallSignals(callId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_call_signals')
    .select('*')
    .eq('call_id', callId)
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}
