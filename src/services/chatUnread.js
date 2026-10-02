export function countUnreadChatsByDriver(conversations, currentUserId) {
  const counts = {};

  for (const conversation of conversations || []) {
    if (!conversation?.driver_id) continue;
    const unreadCount = (conversation.chat_messages || []).filter((message) => (
      message
      && message.sender_id !== currentUserId
      && !message.read_at
      && !message.deleted_at
    )).length;
    if (unreadCount > 0) counts[conversation.driver_id] = unreadCount;
  }

  return counts;
}

export function clearUnreadForDriver(counts, driverId) {
  if (!counts?.[driverId]) return counts || {};
  const next = { ...counts };
  delete next[driverId];
  return next;
}
