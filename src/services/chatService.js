import { requireSupabase } from '../lib/supabase';

const bucket = 'chat-media';

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
  if (!message.storage_path) return message;
  const { data, error } = await client.storage.from(bucket).createSignedUrl(message.storage_path, 3600);
  if (error) return { ...message, mediaError: error.message };
  return { ...message, mediaUrl: data?.signedUrl || null };
}

export async function fetchChatMessages(conversationId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw error;
  return Promise.all((data || []).map((message) => withMediaUrl(client, message)));
}

export async function sendTextMessage(conversationId, text) {
  const client = requireSupabase();
  const result = await client.rpc('send_chat_message', {
    conversation_id: conversationId,
    message_kind: 'text',
    message_body: text.trim(),
    message_client_id: crypto.randomUUID(),
  });
  return assertNoError(result);
}

function fileKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
}

export async function sendMediaMessage({ conversationId, companyId, file, durationMs = null }) {
  const client = requireSupabase();
  const path = `${companyId}/${conversationId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await client.storage.from(bucket).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  try {
    const result = await client.rpc('send_chat_message', {
      conversation_id: conversationId,
      message_kind: fileKind(file),
      message_body: null,
      media_storage_path: path,
      media_file_name: file.name,
      media_mime_type: file.type || 'application/octet-stream',
      media_size_bytes: file.size,
      media_duration_ms: durationMs,
      message_client_id: crypto.randomUUID(),
    });
    return assertNoError(result);
  } catch (error) {
    await client.storage.from(bucket).remove([path]);
    throw error;
  }
}

export async function markChatRead(conversationId) {
  const client = requireSupabase();
  const result = await client.rpc('mark_chat_read', { target_conversation_id: conversationId });
  return assertNoError(result);
}

export async function deleteChatMessage(message) {
  const client = requireSupabase();
  const result = await client.rpc('delete_chat_message', {
    target_message_id: message.id,
  });
  const storagePath = assertNoError(result);
  if (storagePath) {
    await client.storage.from(bucket).remove([storagePath]);
  }
}

export async function fetchUnreadChatCount() {
  const client = requireSupabase();
  const result = await client.rpc('get_unread_chat_count');
  return Number(assertNoError(result) || 0);
}

export function subscribeChat({ conversationId, onMessage, onMessageUpdated }) {
  const client = requireSupabase();
  const channel = client
    .channel(`chat:${conversationId}:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}`,
    }, async ({ new: message }) => onMessage?.(await withMediaUrl(client, message)))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}`,
    }, async ({ new: message }) => onMessageUpdated?.(message.deleted_at ? message : await withMediaUrl(client, message)))
    .subscribe();
  return () => client.removeChannel(channel);
}

export function subscribeCalls({ onCall, onSignal }) {
  const client = requireSupabase();
  const channel = client
    .channel(`chat-calls:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'chat_calls',
    }, ({ new: call }) => onCall?.(call))
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_call_signals',
    }, ({ new: signal }) => onSignal?.(signal))
    .subscribe();
  return () => client.removeChannel(channel);
}

export async function fetchRingingCalls() {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_calls')
    .select('*')
    .eq('status', 'ringing')
    .order('started_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}

export function subscribeUnreadChats(onChange) {
  const client = requireSupabase();
  const channel = client
    .channel(`chat-unread:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, onChange)
    .subscribe();
  return () => client.removeChannel(channel);
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
