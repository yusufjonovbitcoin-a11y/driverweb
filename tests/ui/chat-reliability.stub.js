// Isolated service boundary: nothing in this fixture can contact Supabase.
window.chatBackend = { heartbeats: 0, uploads: 0, call: null, handlers: {} };
export const openChat = async () => 'synthetic-conversation';
export const fetchChatPreviews = async () => [];
export const fetchUnreadChatCountsByDriver = async () => ({});
export const subscribeChatPreviews = () => () => {};
export const subscribeChat = ({ onStatus }) => { onStatus('SUBSCRIBED'); return { ready: Promise.resolve(), unsubscribe() {} }; };
export const fetchChatMessages = async () => ({ messages: [], hasMore: false });
export const syncChatHistory = fetchChatMessages;
export const searchChatMessages = fetchChatMessages;
export const fetchChatMediaCounts = async () => ({});
export const markChatRead = async () => {};
export const markChatUnread = async () => null;
export const clearChatUnread = async () => {};
export const deleteChatMessage = async () => { throw new Error('Not enabled in fixture'); };
export const editChatMessage = deleteChatMessage;
export const sendTextMessage = deleteChatMessage;
export const hydrateChatMessageMedia = async message => message;
export const refreshChatMessageMedia = hydrateChatMessageMedia;
export const sendMediaMessage = async () => { window.chatBackend.uploads++; throw new Error('No real uploads in fixture'); };
export const fetchRingingCalls = async () => [];
export const fetchChatCall = async () => ({ ...window.chatBackend.call });
export const fetchRtcIceServers = async () => [];
export const subscribeCalls = handlers => { window.chatBackend.handlers = handlers; return () => { window.chatBackend.handlers = {}; }; };
export const startCall = async () => {
  window.chatBackend.call = { id: 'synthetic-call', conversation_id: 'synthetic-conversation', initiator_id: 'fixture-user', recipient_id: 'fixture-driver', kind: 'audio', status: 'accepted' };
  return { ...window.chatBackend.call };
};
export const respondCall = async (_, status) => { window.chatBackend.call.status = status; return { ...window.chatBackend.call }; };
export const heartbeatCall = async () => {
  window.chatBackend.heartbeats++;
  if (window.chatBackend.heartbeats > 10) throw new Error('Synthetic heartbeat storm guard');
  // Reproduce the server UPDATE triggered by every heartbeat.
  setTimeout(() => window.chatBackend.handlers.onCall?.({ ...window.chatBackend.call }), 0);
  return { ...window.chatBackend.call };
};
export const fetchCallSignals = async () => [];
export const publishSignal = async () => {
  setTimeout(() => window.chatBackend.handlers.onSignal?.({ id: 1, call_id: 'synthetic-call', recipient_id: 'fixture-user', kind: 'answer', payload: { type: 'answer', sdp: 'v=0\r\na=ice-ufrag:fixture-answer\r\n' } }), 0);
};
