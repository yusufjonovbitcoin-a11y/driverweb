import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { createTimelineRestorer, readTimelinePosition, timelineLocation, timelineWindow } from './chatTimelinePosition';

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

export default function ChatTimeline({ isVisible = true, restoreState, onSaveState, ...props }) {
  const host = useRef(null);
  const snapshot = useRef(restoreState);
  const [viewportHeight, setViewportHeight] = useState(0);
  useLayoutEffect(() => {
    if (!isVisible) return;
    const measure = () => {
      const rect = host.current?.getBoundingClientRect();
      setViewportHeight(rect && rect.width > 0 ? Math.floor(rect.height) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [isVisible]);
  const save = useCallback((value) => {
    if (!value) return;
    snapshot.current = value;
    onSaveState?.(value);
  }, [onSaveState]);
  const getRestoreState = useCallback(() => snapshot.current, []);
  return <div ref={host} className="relative min-h-0 flex-1 overflow-hidden">
    {isVisible && viewportHeight > 0 && <VisibleChatTimeline {...props} viewportHeight={viewportHeight} getRestoreState={getRestoreState} onSaveState={save} />}
  </div>;
}

function VisibleChatTimeline({ messages, children, viewportHeight, getRestoreState, onSaveState,
  hasOlderMessages = false, loadingOlder = false, onLoadOlder }) {
  const list = useRef(null);
  const scroller = useRef(null);
  const [scrollElement, setScrollElement] = useState(null);
  const restorer = useRef(null);
  const restoring = useRef(true);
  const initialSnapshot = useRef(null);
  const messagesRef = useRef(messages);
  const heightRef = useRef(0);
  const userNavigated = useRef(false);
  const olderRequest = useRef(null);
  const [anchor, setAnchor] = useState(() => ({ ids: messages.map(message => message.id), index: 1000000, epoch: 0 }));
  const stateCallback = useRef(onSaveState);
  useLayoutEffect(() => { stateCallback.current = onSaveState; messagesRef.current = messages; }, [onSaveState, messages]);
  const saveState = useCallback(() => {
    if (restoring.current) return;
    const position = readTimelinePosition(scroller.current);
    if (position) stateCallback.current?.(position);
  }, []);
  useLayoutEffect(() => {
    restoring.current = true;
    initialSnapshot.current = getRestoreState();
    const controller = createTimelineRestorer({
      locate: () => ({ ...timelineLocation(messagesRef.current, initialSnapshot.current), anchorId: initialSnapshot.current?.anchorId }),
      read: () => readTimelinePosition(scroller.current),
      scroll: (target) => {
        if (target.index === 'LAST' && scroller.current) {
          // Use the actual DOM extent, not the virtualizer's estimated last
          // item offset. This also recovers ranges measured while hidden.
          scroller.current.scrollTop = scroller.current.scrollHeight;
        } else list.current?.scrollToIndex(target);
      },
      onStart: () => { restoring.current = true; },
      onDone: () => { restoring.current = false; saveState(); },
    });
    restorer.current = controller;
    controller.measure(heightRef.current);
    return () => { saveState(); controller.dispose(); restorer.current = null; };
  }, [saveState, getRestoreState]);
  const setScroller = useCallback((element) => { scroller.current = element; setScrollElement(element); }, []);
  const onHeight = useCallback((height) => { heightRef.current = height; restorer.current?.measure(height); }, []);
  const interrupt = useCallback(() => { userNavigated.current = true; restorer.current?.interrupt(); }, []);
  const loadOlder = useCallback(() => {
    if (!userNavigated.current || restoring.current || loadingOlder || !hasOlderMessages || !onLoadOlder) return;
    const cursor = messagesRef.current[0]?.id;
    if (!cursor || olderRequest.current === cursor) return;
    olderRequest.current = cursor;
    // One automatic attempt per cursor; the explicit button remains the retry
    // path after a network failure, instead of a scroll-triggered retry storm.
    void Promise.resolve().then(onLoadOlder).catch(() => {});
  }, [hasOlderMessages, loadingOlder, onLoadOlder]);
  useLayoutEffect(() => { restorer.current?.measure(viewportHeight); }, [viewportHeight]);
  useEffect(() => {
    const element = scrollElement;
    if (!element) return;
    const onScroll = () => { saveState(); if (element.scrollTop < 120) loadOlder(); };
    const onIntent = () => { interrupt(); if (element.scrollTop < 120) loadOlder(); };
    const observer = new MutationObserver(() => restorer.current?.measure(element.scrollHeight));
    observer.observe(element, { childList: true, subtree: true });
    element.addEventListener('scroll', onScroll, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(event, onIntent, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.removeEventListener(event, onIntent);
    };
  }, [scrollElement, saveState, interrupt, loadOlder]);
  const nextAnchor = timelineWindow(anchor, messages);
  const firstItemIndex = nextAnchor.index;
  if (nextAnchor !== anchor) setAnchor(nextAnchor);
  return <div className="relative h-full min-h-0">
    <Virtuoso key={nextAnchor.epoch} ref={list} style={{ height: viewportHeight }} data={messages}
      startReached={loadOlder}
      firstItemIndex={firstItemIndex} scrollerRef={setScroller} totalListHeightChanged={onHeight}
      computeItemKey={(_, message) => message.id} followOutput={(bottom) => bottom ? 'auto' : false}
      rangeChanged={saveState} increaseViewportBy={200}
      itemContent={(index, message) => <div data-chat-message-id={message.id} className="px-4 pb-2">{children(message, index - firstItemIndex)}</div>} />
  </div>;
}
