export const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export function voiceExtension(type) {
  return ({ 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' })[type.split(';')[0]] || 'webm';
}

export function createVoiceRecording({ recorder, stream, onComplete, onStop = () => {}, onTick = () => {}, onLimit = () => {}, onError = () => {},
  maxDurationMs = VOICE_MAX_DURATION_MS, maxBytes = VOICE_MAX_BYTES, now = Date.now,
  setTimer = setInterval, clearTimer = clearInterval }) {
  let chunks = []; let size = 0; let discarded = false; let stopping = false; let stopped = false;
  const started = now();
  let timer;
  const release = () => { clearTimer(timer); stream.getTracks().forEach(track => track.stop()); };
  const stop = (discard = false) => {
    discarded ||= discard;
    if (discarded) { chunks = []; release(); }
    if (stopping || stopped) return;
    stopping = true;
    clearTimer(timer);
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const limit = () => { if (!stopping) { onLimit(); stop(); } };
  recorder.ondataavailable = ({ data }) => {
    if (discarded || stopped || !data.size) return;
    // Dropping a container's final chunk can make an MP4/WebM unplayable.
    // Reject the recording as a whole if the final flush exceeds the ceiling.
    if (size + data.size > maxBytes) { if (!stopping) onLimit(); stop(true); return; }
    chunks.push(data); size += data.size;
    if (size >= maxBytes) limit();
  };
  recorder.onerror = event => {
    stop(true);
    if (!stopped) { stopped = true; release(); onStop(); }
    onError(event.error || new Error('CHAT_RECORDING_FAILED'));
  };
  recorder.onstop = () => {
    if (stopped) return;
    stopped = true; release(); onStop();
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    chunks = [];
    if (!discarded && blob.size) {
      const file = new File([blob], `voice-${started}.${voiceExtension(blob.type)}`, { type: blob.type });
      const duration = Math.min(now() - started, maxDurationMs);
      Promise.resolve().then(() => { if (!discarded) return onComplete(file, duration); }).catch(onError);
    }
  };
  try { recorder.start(250); } catch (error) { discarded = true; release(); throw error; }
  timer = setTimer(() => { onTick(Math.floor((now() - started) / 1000)); if (now() - started >= maxDurationMs) limit(); }, 1000);
  return { stop: () => stop(), cancel: () => stop(true) };
}
