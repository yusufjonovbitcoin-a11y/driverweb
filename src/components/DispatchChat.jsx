import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCheck, Download, FileText, LoaderCircle, Mic, Paperclip,
  Phone, PhoneOff, Send, Square, Trash2, Video,
} from 'lucide-react';
import {
  deleteChatMessage, fetchCallSignals, fetchChatMessages, markChatRead, openChat, publishSignal,
  respondCall, sendMediaMessage, sendTextMessage, startCall, subscribeChat,
} from '../services/chatService';

const terminalCallStates = new Set(['declined', 'missed', 'ended']);

function messageTime(value) {
  return new Date(value).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
}

function messagePreview(message) {
  if (!message) return 'Yangi suhbat';
  if (message.kind === 'text') return message.body;
  return { image: 'Rasm', video: 'Video', audio: 'Ovozli xabar', file: 'Fayl' }[message.kind] || 'Xabar';
}

function MediaMessage({ message }) {
  if (message.kind === 'image') {
    return <img src={message.mediaUrl} alt={message.file_name || 'Chat rasmi'} className="max-h-72 rounded-2xl object-cover" />;
  }
  if (message.kind === 'video') {
    return <video src={message.mediaUrl} controls playsInline className="max-h-72 max-w-full rounded-2xl" />;
  }
  if (message.kind === 'audio') {
    return <audio src={message.mediaUrl} controls preload="metadata" className="max-w-full h-10" />;
  }
  return (
    <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold underline">
      <FileText className="w-5 h-5" />
      <span className="truncate">{message.file_name || 'Fayl'}</span>
      <Download className="w-4 h-4" />
    </a>
  );
}

export default function DispatchChat({ drivers, activeChatDriver, currentUser, onUnreadChange }) {
  const [selectedDriver, setSelectedDriver] = useState(activeChatDriver || drivers[0] || null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recordingStartedRef = useRef(0);
  const peerRef = useRef(null);
  const activeCallRef = useRef(null);
  const pendingIceRef = useRef([]);
  const handledSignalsRef = useRef(new Set());
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (!selectedDriver && drivers.length) setSelectedDriver(drivers[0]);
  }, [drivers, selectedDriver]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream, activeCall]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, activeCall]);

  const cleanupCall = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    activeCallRef.current = null;
    pendingIceRef.current = [];
    handledSignalsRef.current.clear();
  }, []);

  const handleSignal = useCallback(async (signal) => {
    const call = activeCallRef.current;
    if (!call || signal.call_id !== call.id || signal.recipient_id !== currentUser.id) return;
    if (handledSignalsRef.current.has(signal.id)) return;
    handledSignalsRef.current.add(signal.id);
    const peer = peerRef.current;
    if (!peer) return;

    if (signal.kind === 'offer') {
      await peer.setRemoteDescription(signal.payload);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await publishSignal(call.id, 'answer', answer);
      for (const candidate of pendingIceRef.current.splice(0)) await peer.addIceCandidate(candidate);
    } else if (signal.kind === 'answer') {
      await peer.setRemoteDescription(signal.payload);
      for (const candidate of pendingIceRef.current.splice(0)) await peer.addIceCandidate(candidate);
    } else if (signal.kind === 'ice') {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.payload);
      else pendingIceRef.current.push(signal.payload);
    }
  }, [currentUser.id]);

  const preparePeer = useCallback(async (call, caller) => {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error('Bu brauzer audio/video qo‘ng‘iroqni qo‘llamaydi.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' });
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = ({ streams }) => setRemoteStream(streams[0]);
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) publishSignal(call.id, 'ice', candidate.toJSON()).catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        respondCall(call.id, 'ended').catch(() => {});
        cleanupCall();
      }
    };
    peerRef.current = peer;
    setLocalStream(stream);
    setActiveCall(call);
    activeCallRef.current = call;
    if (caller) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await publishSignal(call.id, 'offer', offer);
    }
  }, [cleanupCall]);

  const processCall = useCallback((call) => {
    if (!call?.id) return;
    if (terminalCallStates.has(call.status)) {
      if (activeCallRef.current?.id === call.id) cleanupCall();
      setIncomingCall((current) => current?.id === call.id ? null : current);
      return;
    }
    if (call.recipient_id === currentUser.id && call.status === 'ringing' && !activeCallRef.current) {
      setIncomingCall(call);
    }
    if (activeCallRef.current?.id === call.id) {
      activeCallRef.current = call;
      setActiveCall(call);
    }
  }, [cleanupCall, currentUser.id]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    if (!selectedDriver?.id) return undefined;
    setLoading(true);
    setError('');
    setMessages([]);
    setConversationId(null);
    (async () => {
      try {
        const id = await openChat(selectedDriver.id);
        if (cancelled) return;
        setConversationId(id);
        const rows = await fetchChatMessages(id);
        if (cancelled) return;
        setMessages(rows);
        await markChatRead(id);
        onUnreadChange?.();
        unsubscribe = subscribeChat({
          conversationId: id,
          onMessage: (message) => {
            setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
            if (message.sender_id !== currentUser.id) markChatRead(id).then(() => onUnreadChange?.()).catch(() => {});
          },
          onMessageUpdated: (message) => {
            setMessages((previous) => message.deleted_at
              ? previous.filter((item) => item.id !== message.id)
              : previous.map((item) => item.id === message.id ? { ...item, ...message } : item));
            onUnreadChange?.();
          },
          onCall: processCall,
          onSignal: (signal) => handleSignal(signal).catch((signalError) => setError(signalError.message)),
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Chatni ochib bo‘lmadi.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; unsubscribe(); };
  }, [selectedDriver?.id, currentUser.id, handleSignal, processCall, onUnreadChange]);

  useEffect(() => () => {
    const call = activeCallRef.current;
    if (call) respondCall(call.id, 'ended').catch(() => {});
    cleanupCall();
  }, [cleanupCall]);

  const sendMessage = async (event) => {
    event?.preventDefault();
    if (!conversationId || !inputMessage.trim() || sending) return;
    const text = inputMessage.trim();
    setInputMessage('');
    setSending(true);
    try {
      const message = await sendTextMessage(conversationId, text);
      setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
    } catch (sendError) {
      setInputMessage(text);
      setError(sendError.message || 'Xabar yuborilmadi.');
    } finally {
      setSending(false);
    }
  };

  const uploadFile = async (file, durationMs = null) => {
    if (!file || !conversationId) return;
    setSending(true);
    setError('');
    try {
      await sendMediaMessage({ conversationId, companyId: currentUser.companyId, file, durationMs });
    } catch (uploadError) {
      setError(uploadError.message || 'Media yuborilmadi.');
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (message) => {
    if (message.sender_id !== currentUser.id) return;
    if (!window.confirm('Xabarni ikkala tomondan o‘chirasizmi?')) return;
    setError('');
    try {
      await deleteChatMessage(message);
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
      onUnreadChange?.();
    } catch (deleteError) {
      setError(deleteError.message || 'Xabar o‘chirilmadi.');
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined;
      const recorder = new MediaRecorder(stream, options);
      recorderChunksRef.current = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) recorderChunksRef.current.push(data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        await uploadFile(file, Date.now() - recordingStartedRef.current);
      };
      recorderRef.current = recorder;
      recordingStartedRef.current = Date.now();
      recorder.start(250);
      setRecording(true);
    } catch (recordError) {
      setError(recordError.message || 'Mikrofonga ruxsat berilmadi.');
    }
  };

  const placeCall = async (kind) => {
    if (!conversationId) return;
    let call;
    try {
      setError('');
      call = await startCall(conversationId, kind);
      await preparePeer(call, true);
    } catch (callError) {
      if (call) await respondCall(call.id, 'ended').catch(() => {});
      cleanupCall();
      setError(callError.message || 'Qo‘ng‘iroq boshlanmadi.');
    }
  };

  const acceptIncomingCall = async () => {
    const call = incomingCall;
    if (!call) return;
    let accepted;
    try {
      await respondCall(call.id, 'accepted');
      accepted = { ...call, status: 'accepted' };
      setIncomingCall(null);
      await preparePeer(accepted, false);
      const signals = await fetchCallSignals(call.id);
      for (const signal of signals) await handleSignal(signal);
    } catch (callError) {
      if (accepted) await respondCall(call.id, 'ended').catch(() => {});
      cleanupCall();
      setError(callError.message || 'Qo‘ng‘iroqqa ulanib bo‘lmadi.');
    }
  };

  const declineIncomingCall = async () => {
    if (incomingCall) await respondCall(incomingCall.id, 'declined').catch(() => {});
    cleanupCall();
  };

  const endCall = async () => {
    const call = activeCallRef.current;
    if (call) await respondCall(call.id, 'ended').catch(() => {});
    cleanupCall();
  };

  if (!selectedDriver) {
    return <div className="h-[calc(100vh-8rem)] grid place-items-center text-zinc-500">Chat uchun haydovchi topilmadi.</div>;
  }

  return (
    <div className="relative grid grid-cols-1 md:grid-cols-[320px_1fr] h-[calc(100vh-8rem)] min-h-[620px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
      <aside className="hidden md:flex border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950 flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-black text-zinc-950 dark:text-white">Chatlar</h2>
          <p className="text-xs text-zinc-500">DriverApp bilan jonli aloqa</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {drivers.map((driver) => {
            const selected = driver.id === selectedDriver.id;
            return (
              <button key={driver.id} onClick={() => setSelectedDriver(driver)} className={`w-full p-4 flex gap-3 text-left border-b border-zinc-200/70 dark:border-zinc-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/25' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}>
                <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white grid place-items-center font-black flex-none">
                  {driver.name?.charAt(0)}
                  {driver.isOnline && <span className="absolute right-0 bottom-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-950" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{driver.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{driver.driverNumber} · {driver.truck}</p>
                  <p className="text-xs text-zinc-400 truncate mt-1">{selected ? messagePreview(messages[messages.length - 1]) : 'Suhbatni ochish'}</p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col bg-[radial-gradient(circle_at_top,#eef6ff_0,transparent_55%)] dark:bg-none dark:bg-zinc-900/30">
        <header className="h-16 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white grid place-items-center font-black flex-none">
              {selectedDriver.name?.charAt(0)}
              {selectedDriver.isOnline && <span className="absolute right-0 bottom-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-950" />}
            </div>
            <div className="min-w-0">
              <p className="font-black truncate">{selectedDriver.name}</p>
              <p className={`text-xs font-semibold ${selectedDriver.isOnline ? 'text-emerald-500' : 'text-zinc-400'}`}>{selectedDriver.isOnline ? 'Onlayn' : 'Oflayn'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => placeCall('audio')} title="Audio qo‘ng‘iroq" className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-blue-600"><Phone className="w-5 h-5" /></button>
            <button onClick={() => placeCall('video')} title="Video qo‘ng‘iroq" className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-blue-600"><Video className="w-5 h-5" /></button>
          </div>
        </header>

        {error && <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs">{error}</div>}

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-2">
          {loading && <div className="h-full grid place-items-center"><LoaderCircle className="animate-spin text-blue-600" /></div>}
          {!loading && messages.length === 0 && (
            <div className="h-full grid place-items-center text-center text-zinc-500">
              <div><div className="text-5xl mb-3">👋</div><p className="font-black text-zinc-800 dark:text-zinc-100">Suhbatni boshlang</p><p className="text-sm">Xabar, rasm, video yoki ovoz yuboring.</p></div>
            </div>
          )}
          {messages.map((message) => {
            const mine = message.sender_id === currentUser.id;
            return (
              <div key={message.id} className={`group flex items-center gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                {mine && <button type="button" onClick={() => removeMessage(message)} title="Xabarni o‘chirish" className="p-1.5 rounded-full text-zinc-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"><Trash2 className="w-4 h-4" /></button>}
                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 shadow-sm ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-bl-md'}`}>
                  {message.kind === 'text' ? <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p> : <MediaMessage message={message} />}
                  <div className={`mt-1 text-[10px] flex items-center justify-end gap-1 ${mine ? 'text-blue-100' : 'text-zinc-400'}`}>
                    <span>{messageTime(message.created_at)}</span>
                    {mine && <CheckCheck className={`w-3.5 h-3.5 ${message.read_at ? 'text-cyan-200' : ''}`} />}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} className="px-3 py-3 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-end gap-2">
          <input ref={fileInputRef} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf" onChange={(event) => { uploadFile(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Media yuborish" className="p-2.5 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Paperclip className="w-5 h-5" /></button>
          <div className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3">
            <textarea rows="1" value={inputMessage} onChange={(event) => setInputMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Xabar yozing…" className="w-full max-h-28 resize-none bg-transparent py-2.5 text-sm outline-none" />
          </div>
          {inputMessage.trim() ? (
            <button type="submit" disabled={sending} className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">{sending ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}</button>
          ) : (
            <button type="button" onClick={toggleRecording} title="Ovozli xabar" className={`p-2.5 rounded-full text-white ${recording ? 'bg-red-600 animate-pulse' : 'bg-blue-600'}`}>{recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
          )}
        </form>
      </section>

      {incomingCall && (
        <div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center text-white">
            <div className="w-24 h-24 mx-auto rounded-full bg-blue-600 grid place-items-center text-4xl font-black shadow-2xl">{selectedDriver.name?.charAt(0)}</div>
            <h3 className="mt-5 text-2xl font-black">{selectedDriver.name}</h3>
            <p className="text-zinc-300 mt-1">Kiruvchi {incomingCall.kind === 'video' ? 'video' : 'audio'} qo‘ng‘iroq</p>
            <div className="mt-8 flex justify-center gap-8">
              <button onClick={declineIncomingCall} className="w-16 h-16 rounded-full bg-red-600 grid place-items-center"><PhoneOff /></button>
              <button onClick={acceptIncomingCall} className="w-16 h-16 rounded-full bg-emerald-500 grid place-items-center"><Phone /></button>
            </div>
          </div>
        </div>
      )}

      {activeCall && (
        <div className="absolute inset-0 z-40 bg-zinc-950 text-white flex flex-col">
          <div className="flex-1 relative overflow-hidden grid place-items-center">
            {activeCall.kind === 'video' && remoteStream ? <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" /> : (
              <div className="text-center"><div className="w-28 h-28 mx-auto rounded-full bg-blue-600 grid place-items-center text-5xl font-black">{selectedDriver.name?.charAt(0)}</div><h3 className="text-2xl font-black mt-5">{selectedDriver.name}</h3><p className="text-zinc-400">{activeCall.status === 'ringing' ? 'Chaqirilmoqda…' : 'Ulandi'}</p></div>
            )}
            {activeCall.kind === 'video' && <video ref={localVideoRef} autoPlay playsInline muted className="absolute right-4 top-4 w-40 aspect-[3/4] object-cover rounded-2xl border border-white/30 shadow-xl bg-zinc-800" />}
          </div>
          <div className="h-28 grid place-items-center"><button onClick={endCall} className="w-16 h-16 rounded-full bg-red-600 grid place-items-center"><PhoneOff /></button></div>
        </div>
      )}
    </div>
  );
}
