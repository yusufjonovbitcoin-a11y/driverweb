// Owns negotiation/recovery for one peer. Media capture and call permissions
// remain with the caller; dispose invalidates timers and in-flight sends.
export function createChatRtcConnection({ peer, polite, publish, onState = () => {}, onError = () => {}, onExhausted = () => {},
  retryDelays = [300, 900, 1800], sendTimeoutMs = 5000, recoveryMs = 40000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let closed = false; let makingOffer = false; let offerVersion = 0;
  let deadline; let retryTimer; let restarts = 0;
  const candidates = []; const seenIce = new Set(); const ignoredUfrags = new Set(); const retiredUfrags = new Set();
  const controllers = new Set(); const sleepers = new Map();
  const ufrags = sdp => [...String(sdp || '').matchAll(/^a=ice-ufrag:(.+)$/gm)].map(match => match[1].trim());
  const current = () => !closed && peer.signalingState !== 'closed';
  const pause = ms => new Promise(resolve => {
    const timer = setTimer(() => { sleepers.delete(timer); resolve(); }, ms);
    sleepers.set(timer, resolve);
  });
  const send = async (kind, payload, valid = current) => {
    for (let attempt = 0; ; attempt++) {
      if (!current() || !valid()) throw new DOMException('Call ended or negotiation superseded', 'AbortError');
      const controller = new AbortController(); controllers.add(controller);
      let timer;
      let aborted;
      try {
        return await Promise.race([
          publish(kind, payload, controller.signal),
          new Promise((_, reject) => {
            aborted = () => reject(new DOMException('Signal request cancelled', 'AbortError'));
            controller.signal.addEventListener('abort', aborted, { once: true });
          }),
          new Promise((_, reject) => { timer = setTimer(() => { controller.abort(); reject(new Error('CHAT_SIGNAL_TIMEOUT')); }, sendTimeoutMs); }),
        ]);
      } catch (error) {
        if (!current() || !valid() || attempt >= retryDelays.length || /Active call not found|authentication|permission|CHAT_.*(?:BLOCK|RATE_LIMIT)/i.test(error.message || '')) throw error;
        await pause(retryDelays[attempt]);
      } finally { clearTimer(timer); controller.signal.removeEventListener('abort', aborted); controllers.delete(controller); }
    }
  };
  const offer = async (restart = false) => {
    if (!current() || makingOffer || peer.signalingState !== 'stable') return;
    makingOffer = true;
    const version = ++offerVersion;
    try {
      if (restart) peer.restartIce();
      const description = await peer.createOffer(restart ? { iceRestart: true } : undefined);
      if (!current() || version !== offerVersion || peer.signalingState !== 'stable') return;
      await peer.setLocalDescription(description);
      if (!current() || version !== offerVersion) return;
      await send('offer', { type: peer.localDescription.type, sdp: peer.localDescription.sdp }, () => version === offerVersion);
    } catch (error) {
      if (current() && version === offerVersion) throw error;
    } finally { makingOffer = false; }
  };
  const addCandidate = async candidate => {
    const fragment = candidate.usernameFragment;
    if (fragment && (ignoredUfrags.has(fragment) || retiredUfrags.has(fragment))) return;
    if (!peer.remoteDescription || (fragment && !ufrags(peer.remoteDescription.sdp).includes(fragment))) {
      if (candidates.length < 256 && !candidates.some(item => JSON.stringify(item) === JSON.stringify(candidate))) candidates.push(candidate);
      return;
    }
    const key = JSON.stringify(candidate);
    if (seenIce.has(key)) return;
    await peer.addIceCandidate(candidate);
    seenIce.add(key);
    if (seenIce.size > 512) seenIce.delete(seenIce.values().next().value);
  };
  const setRemote = async payload => {
    const next = ufrags(payload.sdp);
    const previous = ufrags(peer.remoteDescription?.sdp);
    await peer.setRemoteDescription(payload);
    for (const fragment of previous) if (!next.includes(fragment)) retiredUfrags.add(fragment);
  };
  const receive = async ({ kind, payload }) => {
    if (!current()) return;
    if (kind === 'ice') {
      await addCandidate(payload);
      return;
    }
    // A timed-out RPC may commit and then be retried after a newer negotiation.
    // Never roll back to an ICE generation that has already been replaced.
    if (ufrags(payload.sdp).some(fragment => retiredUfrags.has(fragment))) return;
    if (kind === 'offer') {
      if (peer.remoteDescription?.sdp === payload.sdp && peer.signalingState === 'stable' && peer.localDescription?.type === 'answer') {
        await send('answer', { type: 'answer', sdp: peer.localDescription.sdp });
        return;
      }
      const collision = makingOffer || peer.signalingState !== 'stable';
      if (collision && !polite) { for (const fragment of ufrags(payload.sdp)) ignoredUfrags.add(fragment); return; }
      ++offerVersion;
      if (peer.signalingState === 'have-local-offer') await peer.setLocalDescription({ type: 'rollback' });
      if (!current()) return;
      for (const fragment of ufrags(payload.sdp)) ignoredUfrags.delete(fragment);
      await setRemote(payload);
      if (!current()) return;
      const answer = await peer.createAnswer();
      if (!current()) return;
      await peer.setLocalDescription(answer);
      if (!current()) return;
      await send('answer', { type: 'answer', sdp: peer.localDescription.sdp });
    } else if (kind === 'answer') {
      // A lost RPC response can produce the same answer twice. A late answer
      // for a rolled-back offer must not destroy the current negotiation.
      if (peer.signalingState !== 'have-local-offer' || peer.remoteDescription?.sdp === payload.sdp) return;
      await setRemote(payload);
    }
    for (const candidate of candidates.splice(0)) { if (current()) await addCandidate(candidate); }
  };
  const clearRecovery = () => { clearTimer(deadline); clearTimer(retryTimer); deadline = null; retryTimer = null; restarts = 0; };
  const recover = () => {
    if (!current()) return;
    if (peer.connectionState === 'connected') { clearRecovery(); onState('connected'); return; }
    if (deadline) return;
    onState('reconnecting');
    deadline = setTimer(() => { if (current() && peer.connectionState !== 'connected') onExhausted(); }, recoveryMs);
    const attempt = async () => {
      if (!current() || !deadline || peer.connectionState === 'connected') return;
      if (peer.signalingState !== 'stable' || makingOffer) { retryTimer = setTimer(attempt, 1000); return; }
      restarts += 1;
      try { await offer(true); } catch (error) { if (current()) onError(error); }
      if (current() && deadline && restarts < 2) retryTimer = setTimer(attempt, 8000);
    };
    retryTimer = setTimer(attempt, polite ? 2500 : 1200);
  };
  return {
    offer, receive, recover,
    sendCandidate: candidate => send('ice', candidate),
    connectionChanged() {
      if (!current()) return;
      if (peer.connectionState === 'connected') { clearRecovery(); onState('connected'); }
      else if (['disconnected', 'failed'].includes(peer.connectionState)) recover();
    },
    dispose() {
      closed = true; ++offerVersion; clearRecovery();
      controllers.forEach(controller => controller.abort()); controllers.clear();
      for (const [timer, resolve] of sleepers) { clearTimer(timer); resolve(); }
      sleepers.clear(); candidates.length = 0; seenIce.clear(); ignoredUfrags.clear(); retiredUfrags.clear();
    },
  };
}
