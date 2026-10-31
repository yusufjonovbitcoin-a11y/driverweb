import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRtcConnection } from './chatRtcConnection.js';

const sdp = (type, fragment) => ({ type, sdp: `v=0\r\na=ice-ufrag:${fragment}\r\n` });
function fakePeer() {
  return { signalingState: 'stable', connectionState: 'connected', localDescription: null, remoteDescription: null, restarts: 0, actions: [],
    restartIce() { this.restarts++; }, async createOffer() { return sdp('offer', `local-${this.restarts}`); }, async createAnswer() { return sdp('answer', 'local-answer'); },
    async setLocalDescription(value) { this.actions.push(value.type); this.localDescription = value; this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable'; },
    async setRemoteDescription(value) { this.remoteDescription = value; this.actions.push(`remote-${value.type}`); this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; },
    async addIceCandidate(value) { this.actions.push(value.candidate); },
  };
}
function timers() {
  let now = 0; let next = 0; const jobs = new Map();
  return { setTimer(fn, delay) { const id = ++next; jobs.set(id, { fn, at: now + delay }); return id; }, clearTimer(id) { jobs.delete(id); },
    async advance(ms) { now += ms; for (const [id, job] of [...jobs]) if (job.at <= now && jobs.has(id)) { jobs.delete(id); await job.fn(); } }, get size() { return jobs.size; } };
}

test('outgoing ICE retries transient failures; no retry after permission denial', async () => {
  let attempts = 0; const peer = fakePeer();
  const rtc = createChatRtcConnection({ peer, polite: false, retryDelays: [0, 0], publish: async () => { if (++attempts < 3) throw new Error('network'); return 1; } });
  await rtc.sendCandidate({ candidate: 'host' }); assert.equal(attempts, 3); rtc.dispose();
  attempts = 0;
  const denied = createChatRtcConnection({ peer, publish: async () => { attempts++; throw new Error('Active call not found'); } });
  await assert.rejects(denied.sendCandidate({}), /Active call/); assert.equal(attempts, 1); denied.dispose();
});
test('duplicate answer and ICE are harmless; restart ICE arriving before SDP is retained', async () => {
  const peer = fakePeer(); const rtc = createChatRtcConnection({ peer, polite: true, publish: async () => {} });
  await rtc.offer(); await rtc.receive({ kind: 'answer', payload: sdp('answer', 'remote-1') });
  await rtc.receive({ kind: 'answer', payload: sdp('answer', 'remote-1') });
  const ice = { candidate: 'new-host', usernameFragment: 'remote-2' };
  await rtc.receive({ kind: 'ice', payload: ice }); assert.equal(peer.actions.includes('new-host'), false);
  await rtc.receive({ kind: 'offer', payload: sdp('offer', 'remote-2') });
  await rtc.receive({ kind: 'ice', payload: ice });
  await rtc.receive({ kind: 'ice', payload: { candidate: 'old-host', usernameFragment: 'remote-1' } });
  assert.equal(peer.actions.filter(value => value === 'new-host').length, 1);
  assert.equal(peer.actions.filter(value => value === 'remote-answer').length, 1);
  assert.equal(peer.actions.includes('old-host'), false); rtc.dispose();
});
test('simultaneous restart offers use polite rollback and impolite rejection', async () => {
  for (const polite of [true, false]) {
    const peer = fakePeer(); const sent = [];
    const rtc = createChatRtcConnection({ peer, polite, publish: async kind => { sent.push(kind); } });
    await rtc.offer(); await rtc.receive({ kind: 'offer', payload: sdp('offer', 'other') });
    assert.equal(peer.actions.includes('rollback'), polite);
    assert.equal(sent.includes('answer'), polite);
    rtc.dispose();
  }
});
test('disconnected peer restarts ICE, reconnection cancels termination and dispose cancels all timers', async () => {
  const clock = timers(); const peer = fakePeer(); const states = []; let ended = 0;
  const rtc = createChatRtcConnection({ peer, polite: false, publish: async () => {}, onState: value => states.push(value), onExhausted: () => { ended++; }, ...clock });
  peer.connectionState = 'disconnected'; rtc.connectionChanged(); await clock.advance(1200);
  assert.equal(peer.restarts, 1); assert.ok(states.includes('reconnecting'));
  peer.connectionState = 'connected'; rtc.connectionChanged(); await clock.advance(50000);
  assert.equal(ended, 0); assert.equal(clock.size, 0);
  peer.connectionState = 'failed'; rtc.connectionChanged(); rtc.dispose(); await clock.advance(50000);
  assert.equal(ended, 0); assert.equal(clock.size, 0);
});
test('unrecoverable peer ends once at bounded recovery deadline', async () => {
  const clock = timers(); const peer = fakePeer(); let ended = 0;
  const rtc = createChatRtcConnection({ peer, publish: async () => {}, onExhausted: () => { ended++; rtc.dispose(); }, ...clock });
  peer.connectionState = 'failed'; rtc.connectionChanged(); rtc.connectionChanged();
  await clock.advance(40000); assert.equal(ended, 1); assert.equal(clock.size, 0);
});

test('ending a call aborts an unresponsive publisher without waiting for its timeout', async () => {
  const clock = timers();
  const rtc = createChatRtcConnection({ peer: fakePeer(), publish: () => new Promise(() => {}), ...clock });
  const pending = rtc.sendCandidate({ candidate: 'host' });
  rtc.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(clock.size, 0);
});

test('delayed SDP retries cannot replace the current ICE generation', async () => {
  const peer = fakePeer(); const rtc = createChatRtcConnection({ peer, polite: true, publish: async () => {} });
  await rtc.receive({ kind: 'offer', payload: sdp('offer', 'old') });
  await rtc.receive({ kind: 'offer', payload: sdp('offer', 'new') });
  await rtc.receive({ kind: 'offer', payload: sdp('offer', 'old') });
  assert.equal(peer.remoteDescription.sdp, sdp('offer', 'new').sdp);
  rtc.dispose();
});
