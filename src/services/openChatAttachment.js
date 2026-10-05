// Resolve at the moment of opening, not when a history row was first rendered.
// The temporary tab is opened synchronously to preserve the browser user gesture.
export async function openChatAttachment(message, resolve, open = (...args) => window.open(...args)) {
  const tab = open('about:blank', '_blank');
  if (!tab) throw new Error('CHAT_ATTACHMENT_POPUP_BLOCKED');
  tab.opener = null;
  try {
    const refreshed = await resolve(message);
    if (!refreshed?.mediaUrl) throw new Error(refreshed?.mediaError || 'CHAT_MEDIA_UNAVAILABLE');
    const url = new URL(refreshed.mediaUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('CHAT_MEDIA_UNAVAILABLE');
    if (!tab.closed) tab.location.replace(url.href);
  } catch (error) {
    tab.close();
    throw error;
  }
}
