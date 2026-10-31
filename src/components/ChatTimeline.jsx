import { useTranslation } from 'react-i18next';
import { advanceAnnouncement } from './chatAnnouncementModel';
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

export default function ChatTimeline({ isVisible = true, restoreState, onSaveState, announceNewMessages = true, currentUserId, hasNewerMessages = false, onLatest, ...props }) {
  const { t } = useTranslation();
  const latestRequest = useRef(false);
  const mounted = useRef(true);
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestError, setLatestError] = useState(false);
  const [latestEpoch, setLatestEpoch] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const announcementState = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const { state, incoming } = advanceAnnouncement(announcementState.current, props.messages, currentUserId);
    announcementState.current = state;
    if (!isVisible || !announceNewMessages || !incoming.length) return;
    setAnnouncement(incoming.map(message => t('chat.newMessageAnnouncement', {
      message: message.body || message.file_name || t(`common.${message.kind === 'image' ? 'image' : message.kind === 'video' ? 'video' : message.kind === 'audio' ? 'audio' : 'file'}`),
    })).join(' '));
  }, [props.messages, currentUserId, isVisible, announceNewMessages, t]);
  const host = useRef(null);
  const snapshot = useRef(restoreState);
  const forceBottom = useRef(false);
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
  const getRestoreState = useCallback(() => {
    if (forceBottom.current) { forceBottom.current = false; return { atBottom: true }; }
    return snapshot.current;
  }, []);
  const goToLatest = async () => {
    if (latestRequest.current || !onLatest) return;
    latestRequest.current = true;
    setLatestLoading(true);
    setLatestError(false);
    try {
      await onLatest();
      if (!mounted.current) return;
      snapshot.current = { atBottom: true };
      forceBottom.current = true;
      setLatestEpoch(value => value + 1);
    } catch {
      if (mounted.current) setLatestError(true);
    } finally {
      latestRequest.current = false;
      if (mounted.current) setLatestLoading(false);
    }
  };
  return <div ref={host} className="relative min-h-0 flex-1 overflow-hidden">
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {isVisible && viewportHeight > 0 && <VisibleChatTimeline key={latestEpoch} {...props} viewportHeight={viewportHeight} getRestoreState={getRestoreState} onSaveState={save} />}
    {(hasNewerMessages || latestLoading || latestError) && onLatest && <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {latestError && <p role="alert" className="rounded-lg bg-white px-3 py-2 text-xs text-red-700 shadow dark:bg-zinc-900 dark:text-red-300">{t('errors.chatOpen')}</p>}
      <button type="button" disabled={latestLoading} onClick={goToLatest} className="whitespace-nowrap rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60">
        {latestLoading ? t('common.loading') : t('chat.latestMessages')}
      </button>
    </div>}
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
