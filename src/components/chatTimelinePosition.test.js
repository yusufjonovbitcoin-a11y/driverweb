import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTimelineRestorer, readTimelinePosition, timelineLocation, timelineWindow } from './chatTimelinePosition.js';

const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const latest = { index: 'LAST', align: 'end', behavior: 'auto' };
test('prepend, front removal and unrelated replacement have distinct virtualizer windows', () => {
  const initial = { ids: ['a', 'b', 'c'], index: 1000000, epoch: 0 };
  assert.equal(timelineWindow(initial, [{ id: 'older' }, ...messages]).index, 999999);
  assert.deepEqual(timelineWindow(initial, messages.slice(1)), { ids: ['b', 'c'], index: 1000001, epoch: 0 });
  assert.deepEqual(timelineWindow(initial, [{ id: 'new' }]), { ids: ['new'], index: 1000000, epoch: 1 });
});
function frames() {
  let id = 0; const callbacks = new Map();
  return { requestFrame(callback) { callbacks.set(++id, callback); return id; }, cancelFrame(key) { callbacks.delete(key); },
    tick() { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback()); },
    get size() { return callbacks.size; } };
}

test('new, bottom and obsolete virtualizer snapshots open at the latest message', () => {
  for (const snapshot of [null, { scrollTop: 40000, ranges: [], firstItemIndex: 1000000 }, { version: 1, atBottom: true }, { version: 1, anchorId: 'deleted', atBottom: false }]) {
    assert.deepEqual(timelineLocation(messages, snapshot), latest);
  }
});

test('restores the message ID and partial row offset after older rows are prepended', () => {
  const snapshot = { version: 1, atBottom: false, anchorId: 'b', offset: -27 };
  assert.deepEqual(timelineLocation(messages, snapshot), { index: 1, align: 'start', offset: 27, behavior: 'auto' });
  assert.equal(timelineLocation([{ id: 'older' }, ...messages], snapshot).index, 2);
});

test('only a visible measured viewport can replace the saved reading position', () => {
  const row = (id, top, bottom) => ({ getAttribute: () => id, getBoundingClientRect: () => ({ top, bottom }) });
  const viewport = { clientHeight: 300, clientWidth: 600, scrollHeight: 1200, scrollTop: 400,
    getBoundingClientRect: () => ({ top: 100, bottom: 400 }),
    querySelectorAll: () => [row('overscan', -90, 0), row('b', 80, 170), row('c', 170, 250)] };
  assert.deepEqual(readTimelinePosition(viewport), { version: 1, atBottom: false, anchorId: 'b', offset: -20 });
  assert.equal(readTimelinePosition({ ...viewport, clientHeight: 0 }), null);
  assert.equal(readTimelinePosition({ ...viewport, clientWidth: 0 }), null);
  assert.equal(readTimelinePosition({ ...viewport, querySelectorAll: () => [] }), null);
  assert.equal(readTimelinePosition({ ...viewport, scrollTop: 900 }).atBottom, true);
});

test('positions measured content without the virtualizer initial-hidden state', () => {
  const raf = frames(); const calls = []; let done = 0; let bottom = false;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest, read: () => ({ atBottom: bottom }),
    scroll: (target) => { calls.push(target); bottom = true; }, onDone: () => done++ });
  restorer.measure(0); assert.equal(raf.size, 0);
  restorer.measure(400); restorer.measure(401); assert.equal(raf.size, 1);
  raf.tick(); raf.tick(); raf.tick();
  assert.deepEqual(calls, [latest]); assert.equal(done, 1); assert.equal(raf.size, 0);
  restorer.measure(450); assert.equal(raf.size, 1);
  raf.tick(); raf.tick(); assert.equal(raf.size, 0);
});

test('short chats already at the bottom do not wait for a scroll event', () => {
  const raf = frames(); let done = false;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest, read: () => ({ atBottom: true }),
    scroll: () => assert.fail('no scroll needed'), onDone: () => { done = true; } });
  restorer.measure(80); raf.tick(); raf.tick();
  assert.equal(done, true);
});

test('restores an older message without jumping to latest and refines measured heights', () => {
  const raf = frames(); const calls = []; let position = null; let done = false;
  const restorer = createTimelineRestorer({ ...raf,
    locate: () => ({ index: 1, anchorId: 'b', offset: 20, align: 'start', behavior: 'auto' }), read: () => position,
    scroll: (target) => { calls.push(target); position = { anchorId: 'b', offset: calls.length === 1 ? -10 : -20 }; }, onDone: () => { done = true; } });
  restorer.measure(900);
  for (let index = 0; index < 4; index++) raf.tick();
  assert.equal(calls.length, 2); assert.equal(calls[0].index, 1); assert.equal('anchorId' in calls[0], false); assert.equal(done, true);
});

test('user scrolling cancels automatic positioning immediately', () => {
  const raf = frames(); let calls = 0;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest, read: () => null, scroll: () => calls++ });
  restorer.measure(800); restorer.interrupt(); raf.tick(); restorer.measure(900); raf.tick();
  assert.equal(calls, 0); assert.equal(raf.size, 0);
});

test('Latest explicitly resumes after user navigation and adapts to later measurements', () => {
  const raf = frames(); let bottom = false, calls = 0;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest,
    read: () => ({ atBottom: bottom }), scroll: () => { calls++; bottom = true; } });
  restorer.interrupt(); restorer.measure(800); raf.tick(); assert.equal(calls, 0);
  restorer.resume(800); raf.tick(); raf.tick(); raf.tick();
  assert.equal(calls, 1);
  bottom = false; restorer.measure(1000); raf.tick(); raf.tick(); raf.tick();
  assert.equal(calls, 2);
});

test('leaving the chat cancels frames; reopening starts a fresh measured restoration', () => {
  const raf = frames(); let calls = 0;
  const options = { ...raf, locate: () => latest, read: () => null, scroll: () => calls++ };
  const old = createTimelineRestorer(options); old.measure(800); old.dispose(); raf.tick();
  assert.equal(calls, 0);
  const reopened = createTimelineRestorer(options); reopened.measure(800); raf.tick();
  assert.equal(calls, 1); reopened.dispose(); assert.equal(raf.size, 0);
});

test('unstable row measurements cannot create an infinite scroll loop', () => {
  const raf = frames(); let calls = 0; let done = false;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest, read: () => null, scroll: () => calls++, onDone: () => { done = true; } });
  restorer.measure(900);
  for (let index = 0; index < 30; index++) raf.tick();
  assert.equal(calls, 12); assert.equal(done, true); assert.equal(raf.size, 0);
});

test('late layout recovers after the bounded initial burst, even if it had no visible rows', () => {
  const raf = frames(); let visible = false, bottom = false;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest,
    read: () => visible ? { atBottom: bottom } : null,
    scroll: () => { if (visible) bottom = true; } });
  restorer.measure(900);
  for (let index = 0; index < 30; index++) raf.tick();
  assert.equal(raf.size, 0);
  visible = true;
  restorer.measure(950);
  raf.tick(); raf.tick(); raf.tick();
  assert.equal(bottom, true);
  assert.equal(raf.size, 0);
});

test('a late image keeps the latest message visible until the user scrolls', () => {
  const raf = frames(); let bottom = true, calls = 0;
  const restorer = createTimelineRestorer({ ...raf, locate: () => latest,
    read: () => ({ atBottom: bottom }), scroll: () => { bottom = true; calls++; } });
  restorer.measure(100); raf.tick(); raf.tick();
  bottom = false; restorer.measure(600); raf.tick(); raf.tick(); raf.tick();
  assert.equal(calls, 1);
  restorer.interrupt(); bottom = false; restorer.measure(900); raf.tick();
  assert.equal(calls, 1);
});

test('production wiring gates hidden chat and does not request initial-hidden virtualizer scrolling', () => {
  const timeline = readFileSync(new URL('./ChatTimeline.jsx', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('./DispatchChat.jsx', import.meta.url), 'utf8');
  assert.ok(timeline.includes('isVisible && viewportHeight > 0 &&'));
  assert.ok(timeline.includes('style={{ height: viewportHeight }}'));
  assert.ok(timeline.includes('startReached={loadOlder}'));
  assert.ok(!timeline.includes('chat.latestMessages'), 'Floating latest-messages button is removed');
  assert.ok(timeline.includes('totalListHeightChanged={onHeight}'));
  assert.ok(!timeline.includes('initialTopMostItemIndex='));
  assert.ok(!timeline.includes('restoreStateFrom='));
  assert.match(chat, /<ChatTimeline[^\n]*isVisible=\{isVisible\}/);
});
