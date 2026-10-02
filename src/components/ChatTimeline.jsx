import { useEffect, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';

// Observes the real clipped viewport, not merely the mounted/overscan rows.
export function ChatReadBoundary({ message, enabled, onRead, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!enabled || message.read_at || message.deleted_at) return;
    let intersecting = false;
    let timer;
    const check = () => {
      clearTimeout(timer);
      if (intersecting && document.visibilityState === 'visible' && document.hasFocus()) {
        timer = setTimeout(() => onRead(message.id), 450);
      }
    };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; check(); }, { threshold: 0.1 });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('blur', check);
    return () => { observer.disconnect(); clearTimeout(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); window.removeEventListener('blur', check); };
  }, [enabled, message.id, message.read_at, message.deleted_at, onRead]);
  return <div ref={ref}>{children}</div>;
}

export default function ChatTimeline({ messages, children }) {
  const { t } = useTranslation();
  const list = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const [anchor, setAnchor] = useState({ first: messages[0]?.id, index: 1000000 });
  const first = messages[0]?.id;
  let firstItemIndex = anchor.index;
  if (first !== anchor.first) {
    const prepended = messages.findIndex((message) => message.id === anchor.first);
    firstItemIndex = prepended >= 0 ? anchor.index - prepended : 1000000;
    setAnchor({ first, index: firstItemIndex });
  }
  return <div className="relative min-h-0 flex-1">
    <Virtuoso ref={list} style={{ height: '100%' }} data={messages}
      firstItemIndex={firstItemIndex} initialTopMostItemIndex={Math.max(0, messages.length - 1)}
      computeItemKey={(_, message) => message.id} followOutput={(bottom) => bottom ? 'auto' : false}
      atBottomStateChange={setAtBottom} increaseViewportBy={200}
      itemContent={(index, message) => <div className="px-4 pb-2">{children(message, index - firstItemIndex)}</div>} />
    {!atBottom && <button type="button" onClick={() => list.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' })}
      className="absolute bottom-3 right-4 rounded-full border border-zinc-300 bg-white px-3 py-2 text-sm shadow dark:bg-zinc-800"
      aria-label={t('chat.latestMessages')}>↓ {t('chat.latestMessages')}</button>}
  </div>;
}
