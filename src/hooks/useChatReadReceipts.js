import { useCallback, useEffect, useRef } from 'react';
import { markChatRead } from '../services/chatService';

export function useChatReadReceipts(conversationId, enabled, onRead) {
  const state = useRef({});
  useEffect(() => {
    const current = { conversationId, enabled, ids: new Set(), timer: null, alive: true, onRead };
    state.current = current;
    return () => { current.alive = false; clearTimeout(current.timer); };
  }, [conversationId, enabled, onRead]);
  return useCallback((id) => {
    const current = state.current;
    if (!current.enabled || !current.alive) return;
    current.ids.add(id);
    if (current.timer) return;
    const flush = async () => {
      current.timer = null;
      if (!current.alive || document.visibilityState !== 'visible' || !document.hasFocus()) { current.ids.clear(); return; }
      const ids = [...current.ids];
      current.ids.clear();
      try {
        for (let offset = 0; offset < ids.length && current.alive; offset += 100) {
          const batch = ids.slice(offset, offset + 100);
          await markChatRead(current.conversationId, batch);
          if (current.alive) current.onRead(batch);
        }
      } catch {
        if (current.alive) {
          ids.forEach((messageId) => current.ids.add(messageId));
          current.timer = setTimeout(flush, 5000);
        }
      }
    };
    current.timer = setTimeout(flush, 200);
  }, []);
}
