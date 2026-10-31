import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setAppLocale } from '../../src/i18n/index.js';
import ChatTimeline from '../../src/components/ChatTimeline.jsx';
import DispatchChat from '../../src/components/DispatchChat.jsx';
import { createChatRtcConnection } from '../../src/services/chatRtcConnection.js';
import { RtcSignalQueue } from '../../src/services/rtcSignalQueue.js';
import { createVoiceRecording } from '../../src/services/chatVoiceRecording.js';
import '../../src/index.css';

await setAppLocale('en', { persist: false });
const messages = Array.from({ length: 800 }, (_, i) => ({ id: `message-${i + 1}`, body: `Message ${i + 1}`, sender_id: 'fixture', created_at: new Date(100000 + i * 1000).toISOString() }));
window.latestAttempts = 0;
window.failNextLatest = false;
export function TimelineFixture() {
  const [rows, setRows] = useState(messages.slice(0, 500));
  const [detached, setDetached] = useState(true);
  return <main style={{ height: 650, width: 700, display: 'flex', flexDirection: 'column', margin: 20 }}>
    <h1>Synthetic long history</h1>
    <ChatTimeline messages={rows} restoreState={{ atBottom: true }} currentUserId="fixture" hasNewerMessages={detached} onLatest={async () => {
      window.latestAttempts++;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (window.failNextLatest) { window.failNextLatest = false; throw new Error('Synthetic offline'); }
      setRows(messages.slice(-100)); setDetached(false);
    }}>{message => <article style={{ minHeight: 42, padding: 10 }}>{message.body}</article>}</ChatTimeline>
  </main>;
}
const integration = new URLSearchParams(location.search).has('integration');
if (integration) {
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  window.syntheticMic = destination.stream;
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => destination.stream });
  window.RTCPeerConnection = class {
    signalingState = 'stable'; connectionState = 'new'; remoteDescription = null; localDescription = null;
    addTrack() {} getSenders() { return []; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:fixture\r\n' }; }
    async setLocalDescription(value) { this.localDescription = value; this.signalingState = 'have-local-offer'; }
    async setRemoteDescription(value) { this.remoteDescription = value; this.signalingState = 'stable'; this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
    close() { this.signalingState = 'closed'; this.connectionState = 'closed'; }
  };
}
createRoot(document.getElementById('root')).render(integration
  ? <div style={{ height: 700 }}><DispatchChat drivers={[{ id: 'fixture-driver', name: 'Synthetic Driver' }]} currentUser={{ id: 'fixture-user', companyId: 'fixture-company', roleCode: 'dispatcher' }} /></div>
  : <StrictMode><TimelineFixture /></StrictMode>);

window.recordSyntheticAudio = async () => {
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(destination); oscillator.start();
  const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
  try {
    return await new Promise((resolve, reject) => {
      createVoiceRecording({ recorder, stream: destination.stream, maxDurationMs: 1000,
        onError: reject, onComplete: async file => {
          try {
            const decoded = await audio.decodeAudioData(await file.arrayBuffer());
            resolve({ name: file.name, bytes: file.size, duration: decoded.duration, tracksEnded: destination.stream.getTracks().every(track => track.readyState === 'ended') });
          } catch (error) { reject(error); }
        },
      });
    });
  } finally { oscillator.stop(); await audio.close(); }
};

// Real browser peer connections, private to this fixture. No backend, microphone,
// STUN, TURN, real conversation or recipient is involved.
window.createTestCall = async ({ dropFirstIce = false } = {}) => {
  const peers = [new RTCPeerConnection({ iceServers: [] }), new RTCPeerConnection({ iceServers: [] })];
  const errors = []; const controllers = []; const queues = [];
  let id = 0; let iceDropped = false; let received = ''; let channel;
  for (let i = 0; i < 2; i++) {
    queues[i] = new RtcSignalQueue({ process: signal => controllers[i].receive(signal) });
    controllers[i] = createChatRtcConnection({ peer: peers[i], polite: i === 1, retryDelays: [10, 20],
      publish: async (kind, payload) => {
        if (dropFirstIce && kind === 'ice' && !iceDropped) { iceDropped = true; throw new Error('Simulated signal outage'); }
        queues[1 - i].enqueue({ id: ++id, kind, payload });
        // Match RPC semantics: commit acknowledges before recipient processes it.
        setTimeout(() => queues[1 - i].drain().catch(error => errors.push(error.message)), 0);
      }, onError: error => errors.push(error.message), onExhausted: () => errors.push('recovery-exhausted'),
    });
    peers[i].onicecandidate = ({ candidate }) => { if (candidate) controllers[i].sendCandidate(candidate.toJSON()).catch(error => errors.push(error.message)); };
    peers[i].onconnectionstatechange = () => controllers[i].connectionChanged();
  }
  peers[1].ondatachannel = event => { event.channel.onmessage = event => { received = event.data; }; };
  channel = peers[0].createDataChannel('synthetic-chat-check');
  window.testCall = {
    snapshot: () => ({ states: peers.map(peer => peer.connectionState), signaling: peers.map(peer => peer.signalingState), errors: [...errors], received, sdp: peers[0].localDescription?.sdp, iceDropped }),
    restart: () => controllers[0].offer(true),
    simultaneousRestart: () => Promise.all(controllers.map(controller => controller.offer(true))),
    send: value => channel.send(value),
    stop: () => { controllers.forEach(controller => controller.dispose()); peers.forEach(peer => peer.close()); },
  };
  await controllers[0].offer();
};
