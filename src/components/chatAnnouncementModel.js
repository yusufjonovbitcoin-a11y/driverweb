export function advanceAnnouncement(state, messages, currentUserId) {
  const latest = Math.max(0, ...messages.map(message => Date.parse(message.created_at) || 0));
  const ids = new Set(messages.map(message => message.id));
  const incoming = state?.initialized ? messages.filter(message =>
    !state.ids.has(message.id) && (Date.parse(message.created_at) || 0) > state.latest &&
    message.sender_id !== currentUserId && !message.status && !message.deleted_at) : [];
  return { state: { initialized: state?.initialized || messages.length > 0,
    latest: Math.max(state?.latest || 0, latest), ids }, incoming };
}
