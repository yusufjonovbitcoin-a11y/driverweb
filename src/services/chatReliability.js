const defaultStunServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function mergeChatMessages(current = [], incoming = []) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!message?.id) continue;
    if (message.deleted_at) byId.delete(message.id);
    else byId.set(message.id, { ...byId.get(message.id), ...message });
  }
  return [...byId.values()].sort((left, right) => {
    const timestamp = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    return timestamp || String(left.id).localeCompare(String(right.id));
  });
}

export function buildChatCursor(messages = []) {
  const oldest = [...messages]
    .filter((message) => message?.id && message?.created_at)
    .sort((left, right) => {
      const timestamp = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      return timestamp || String(left.id).localeCompare(String(right.id));
    })[0];
  return oldest ? { createdAt: oldest.created_at, id: oldest.id } : null;
}

export function buildIceServers({
  turnUrls = '',
  turnUsername = '',
  turnCredential = '',
} = {}) {
  const urls = String(turnUrls)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^turns?:/i.test(value));
  if (!urls.length || !turnUsername || !turnCredential) return defaultStunServers;
  return [
    ...defaultStunServers,
    { urls, username: turnUsername, credential: turnCredential },
  ];
}

export const chatIceServers = () => buildIceServers({
  turnUrls: import.meta.env.VITE_TURN_URLS,
  turnUsername: import.meta.env.VITE_TURN_USERNAME,
  turnCredential: import.meta.env.VITE_TURN_CREDENTIAL,
});
