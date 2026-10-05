export function timelineLocation(messages, snapshot) {
  const index = snapshot?.version === 1 && !snapshot.atBottom
    ? messages.findIndex((message) => message.id === snapshot.anchorId) : -1;
  return index < 0
    ? { index: 'LAST', align: 'end', behavior: 'auto' }
    : { index, align: 'start', offset: -Number(snapshot.offset || 0), behavior: 'auto' };
}

export function timelineWindow(previous, messages) {
  const ids = messages.map(message => message.id);
  if (ids[0] === previous.ids[0]) {
    return ids.length === previous.ids.length && ids.every((id, index) => id === previous.ids[index])
      ? previous : { ...previous, ids };
  }
  const prepended = ids.indexOf(previous.ids[0]);
  if (prepended >= 0) return { ids, index: previous.index - prepended, epoch: previous.epoch };
  const removed = previous.ids.indexOf(ids[0]);
  if (removed >= 0) return { ids, index: previous.index + removed, epoch: previous.epoch };
  return { ids, index: 1000000, epoch: previous.epoch + 1 };
}

export function readTimelinePosition(scroller) {
  if (!scroller || scroller.clientHeight <= 0 || scroller.clientWidth <= 0) return null;
  const viewport = scroller.getBoundingClientRect();
  const rows = [...scroller.querySelectorAll('[data-chat-message-id]')];
  const first = rows.find((row) => {
    const bounds = row.getBoundingClientRect();
    return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
  });
  if (!first) return null;
  return { version: 1,
    atBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 6,
    anchorId: first.getAttribute('data-chat-message-id'),
    offset: first.getBoundingClientRect().top - viewport.top };
}

// Never hide rows while restoring. Wait for measured content, then position it.
// Further measurement passes refine estimated row heights; user input takes over.
export function createTimelineRestorer({ locate, read, scroll, onStart, onDone, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let frame = null;
  let done = false;
  let passes = 0;
  let stable = 0;
  const pause = () => { if (frame !== null) cancelFrame(frame); frame = null; onDone?.(); };
  const finish = () => { if (done) return; done = true; pause(); };
  const step = () => {
    frame = null;
    if (done) return;
    const location = locate();
    const position = read();
    const reached = position && (location.index === 'LAST' ? position.atBottom
      : position.anchorId === location.anchorId && Math.abs(position.offset + location.offset) < 2);
    stable = reached ? stable + 1 : 0;
    // Bound each measurement burst, not the lifetime of restoration. A late
    // image/viewport measurement must still be able to recover a blank range.
    // Only intentional user navigation permanently takes over positioning.
    if (stable >= 2 || ++passes > 12) { pause(); return; }
    if (!reached) { const { anchorId: _, ...target } = location; scroll(target); }
    frame = requestFrame(step);
  };
  return {
    measure(height) {
      if (!done && height > 0 && frame === null) {
        passes = 0; stable = 0; onStart?.(); frame = requestFrame(step);
      }
    },
    interrupt: finish,
    resume(height) { done = false; this.measure(height); },
    dispose() { done = true; if (frame !== null) cancelFrame(frame); frame = null; },
  };
}
