import { createPortal } from 'react-dom';
import { OperationScope, acquireCallMedia, stopMediaStream } from '../services/chatAsyncSafety';
import React, { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCheck, Download, FileText, Image as ImageIcon, Link2, LoaderCircle,
  Maximize2, Mic, MicOff, MonitorUp, Music2, PanelRight, Paperclip, Phone, PhoneOff,
  Search, Send, ShieldCheck, Smile, Square, Trash2, UserRound, Video, VideoOff, X,
} from 'lucide-react';
import {
  deleteChatMessage, fetchCallSignals, fetchChatMessages, fetchRingingCalls, fetchRtcIceServers, heartbeatCall, markChatRead, openChat, refreshChatMessageMedia,
  publishSignal, respondCall, sendMediaMessage, sendTextMessage, startCall, subscribeCalls, subscribeChat,
} from '../services/chatService';
import { buildChatCursor, mergeChatMessages } from '../services/chatReliability';
import { RtcSignalQueue } from '../services/rtcSignalQueue';

const terminalCallStates = new Set(['declined', 'missed', 'ended']);

function messageTime(value) {
  return new Date(value).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
}

function messageDayKey(value) {
  return new Date(value).toDateString();
}

function messageDayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Bugun';
  if (date.toDateString() === yesterday.toDateString()) return 'Kecha';
  return date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long' });
}

function containsLink(message) {
  return message.kind === 'text' && /https?:\/\/\S+/i.test(message.body || '');
}

function messagePreview(message) {
  if (!message) return 'Yangi suhbat';
  if (message.kind === 'text') return message.body;
  return { image: 'Rasm', video: 'Video', audio: 'Ovozli xabar', file: 'Fayl' }[message.kind] || 'Xabar';
}

function callDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function CallControl({ active = false, danger = false, disabled = false, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={danger ? undefined : active}
      className="group flex min-w-0 flex-1 sm:min-w-[72px] flex-col items-center gap-2 text-xs font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`grid h-12 w-12 place-items-center rounded-full border transition-colors ${danger
        ? 'border-red-500 bg-red-500 text-white hover:bg-red-400'
        : active
          ? 'border-white bg-white text-zinc-950'
          : 'border-white/10 bg-white/10 text-white hover:bg-white/20'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="max-w-[90px] text-center leading-tight">{label}</span>
    </button>
  );
}

function CallDialog({ label, children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
    (focusable()[0] || dialog).focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialog.focus(); return; }
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div>;
}

function DriverAvatar({ driver, sizeClass = 'w-11 h-11' }) {
  return (
    <div className={`relative ${sizeClass} flex-none`}>
      <div className="h-full w-full overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white grid place-items-center font-black">
        {driver.avatar ? (
          <img src={driver.avatar} alt={`${driver.name} profil surati`} className="h-full w-full object-cover" />
        ) : driver.name?.charAt(0)}
      </div>
      {driver.isOnline && <span className="absolute right-0 bottom-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-950" />}
    </div>
  );
}

function MediaMessage({ message, onRefresh }) {
  const attemptsRef = useRef(0);
  const [failed, setFailed] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const retry = async (manual = false) => {
    if (recovering || (!manual && attemptsRef.current >= 1)) { setFailed(true); return; }
    attemptsRef.current += 1;
    setFailed(false);
    setRecovering(true);
    try {
      await onRefresh?.(message);
    } catch {
      setFailed(true);
    } finally {
      setRecovering(false);
    }
  };
  if (!message.mediaUrl || failed) {
    return <button type="button" onClick={() => retry(true)} disabled={recovering} className="font-bold underline disabled:opacity-60">{recovering ? 'Media yangilanmoqda…' : 'Mediani qayta yuklash'}</button>;
  }
  if (message.kind === 'image') {
    return <img src={message.mediaUrl} onError={() => { void retry(); }} alt={message.file_name || 'Chat rasmi'} className="max-h-72 rounded-2xl object-cover" />;
  }
  if (message.kind === 'video') {
    return <video src={message.mediaUrl} onError={() => { void retry(); }} controls playsInline className="max-h-72 max-w-full rounded-2xl" />;
  }
  if (message.kind === 'audio') {
    return <audio src={message.mediaUrl} onError={() => { void retry(); }} controls preload="metadata" className="max-w-full h-10" />;
  }
  return (
    <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold underline">
      <FileText className="w-5 h-5" />
      <span className="truncate">{message.file_name || 'Fayl'}</span>
      <Download className="w-4 h-4" />
    </a>
  );
}

export default function DispatchChat({
  drivers,
  activeChatDriver,
  selectionRequestKey = 0,
  currentUser,
  isVisible = true,
  onUnreadChange,
  compact = false,
  onClose,
}) {
  const [selectedDriverId, setSelectedDriverId] = useState(activeChatDriver?.id || drivers[0]?.id || null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [failedUpload, setFailedUpload] = useState(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  ));
  const [mediaFilter, setMediaFilter] = useState('all');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);
  const [callConnectionState, setCallConnectionState] = useState('connecting');
  const [callSeconds, setCallSeconds] = useState(0);
  const fileInputRef = useRef(null);
  const composerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recordingStartedRef = useRef(0);
  const peerRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const pendingIceRef = useRef([]);
  const [signalQueue] = useState(() => new RtcSignalQueue());
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const callOverlayRef = useRef(null);
  const screenStreamRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const disconnectTimerRef = useRef(null);
  const ownedLocalStreamRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const [callScope] = useState(() => new OperationScope());
  const [conversationScope] = useState(() => new OperationScope());
  const conversationCurrentRef = useRef(() => false);
  const visibilityRef = useRef(isVisible);
  const unreadChangeRef = useRef(onUnreadChange);
  const callStartingRef = useRef(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [connectedAt, setConnectedAt] = useState(null);
  const recordingScopeRef = useRef(0);
  useLayoutEffect(() => {
    visibilityRef.current = isVisible;
    unreadChangeRef.current = onUnreadChange;
  }, [isVisible, onUnreadChange]);


  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId)
    || activeChatDriver
    || drivers[0]
    || null;

  const callDriver = useMemo(() => {
    const call = incomingCall || activeCall;
    if (!call) return selectedDriver;
    const peerId = call.initiator_id === currentUser.id ? call.recipient_id : call.initiator_id;
    return drivers.find((driver) => driver.id === peerId) || selectedDriver;
  }, [activeCall, currentUser.id, drivers, incomingCall, selectedDriver]);
  const activeCallId = activeCall?.id;

  const filteredDrivers = useMemo(() => {
    const query = driverSearch.trim().toLowerCase();
    if (!query) return drivers;
    return drivers.filter((driver) => (
      driver.name?.toLowerCase().includes(query)
      || driver.driverNumber?.toLowerCase().includes(query)
      || driver.phone?.toLowerCase().includes(query)
      || driver.truck?.toLowerCase().includes(query)
    ));
  }, [driverSearch, drivers]);

  const mediaStats = useMemo(() => ({
    image: messages.filter((message) => message.kind === 'image').length,
    video: messages.filter((message) => message.kind === 'video').length,
    file: messages.filter((message) => message.kind === 'file').length,
    audio: messages.filter((message) => message.kind === 'audio').length,
    links: messages.filter(containsLink).length,
  }), [messages]);

  const visibleMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    return messages.filter((message) => {
      const matchesType = mediaFilter === 'all'
        || (mediaFilter === 'links' ? containsLink(message) : message.kind === mediaFilter);
      const matchesSearch = !query
        || message.body?.toLowerCase().includes(query)
        || message.file_name?.toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [mediaFilter, messageSearch, messages]);

  const latestMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [latestMessageId]);

  const attachLocalVideo = useCallback((video) => {
    localVideoRef.current = video;
    if (!video) return;
    video.srcObject = localStream;
    if (localStream) video.play().catch(() => {});
  }, [localStream]);

  const attachRemoteVideo = useCallback((video) => {
    remoteVideoRef.current = video;
    if (!video) return;
    video.srcObject = remoteStream;
    if (remoteStream) video.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
  }, [remoteStream]);

  useEffect(() => {
    if (!activeCallId || !connectedAt) return undefined;
    const timer = window.setInterval(() => setCallSeconds(Math.floor((Date.now() - connectedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [activeCallId, connectedAt]);

  const cleanupCall = useCallback(() => {
    callScope.cancel();
    callStartingRef.current = false;
    stopMediaStream(ownedLocalStreamRef.current);
    ownedLocalStreamRef.current = null;
    window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setLocalStream(null);
    setConnectedAt(null);
    setPlaybackBlocked(false);
    setRemoteStream(null);
    setRemoteVideoReady(false);
    setScreenSharing(false);
    setMicrophoneEnabled(true);
    setCameraEnabled(true);
    setCallConnectionState('connecting');
    setCallSeconds(0);
    setActiveCall(null);
    setIncomingCall(null);
    activeCallRef.current = null;
    incomingCallRef.current = null;
    pendingIceRef.current = [];
    signalQueue.reset();
  }, [callScope, signalQueue]);

  const processSignal = useCallback(async (signal) => {
    const call = activeCallRef.current;
    if (!call || signal.call_id !== call.id || signal.recipient_id !== currentUser.id) return;
    const peer = peerRef.current;
    if (!peer) throw new Error('WebRTC peer hali tayyor emas.');
    const stillCurrent = () => peerRef.current === peer && activeCallRef.current?.id === call.id;

    if (signal.kind === 'offer') {
      await peer.setRemoteDescription(signal.payload);
      if (!stillCurrent()) return;
      const answer = await peer.createAnswer();
      if (!stillCurrent()) return;
      await peer.setLocalDescription(answer);
      if (!stillCurrent()) return;
      await publishSignal(call.id, 'answer', answer);
      if (!stillCurrent()) return;
      for (const candidate of pendingIceRef.current.splice(0)) { if (!stillCurrent()) return; await peer.addIceCandidate(candidate); }
    } else if (signal.kind === 'answer') {
      await peer.setRemoteDescription(signal.payload);
      if (!stillCurrent()) return;
      for (const candidate of pendingIceRef.current.splice(0)) { if (!stillCurrent()) return; await peer.addIceCandidate(candidate); }
    } else if (signal.kind === 'ice') {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.payload);
      else pendingIceRef.current.push(signal.payload);
    }
  }, [currentUser.id]);
  const handleSignal = useCallback(async (signal) => {
    const call = activeCallRef.current || incomingCallRef.current;
    if (!call || signal.call_id !== call.id || signal.recipient_id !== currentUser.id) return;
    signalQueue.enqueue(signal);
    if (peerRef.current && activeCallRef.current?.id === signal.call_id) {
      await signalQueue.drain(processSignal);
    }
  }, [currentUser.id, processSignal, signalQueue]);

  const waitForRemoteDescription = useCallback(async (callId, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (
      peerRef.current
      && activeCallRef.current?.id === callId
      && !peerRef.current.remoteDescription
      && Date.now() < deadline
    ) {
      const signals = await fetchCallSignals(callId);
      if (activeCallRef.current?.id !== callId) throw new DOMException('Call cancelled', 'AbortError');
      for (const signal of signals) await handleSignal(signal);
      if (peerRef.current?.remoteDescription) return;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    if (activeCallRef.current?.id !== callId) throw new DOMException('Call cancelled', 'AbortError');
    if (!peerRef.current?.remoteDescription) {
      throw new Error('Qo‘ng‘iroq signali yetib kelmadi. Qayta urinib ko‘ring.');
    }
  }, [handleSignal]);

  const preparePeer = useCallback(async (call, caller, isCurrent) => {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error('Bu brauzer audio/video qo‘ng‘iroqni qo‘llamaydi.');
    }
    const [stream, iceServers] = await acquireCallMedia(
      () => navigator.mediaDevices.getUserMedia({
        audio: true,
        video: call.kind === 'video' ? {
          facingMode: 'user',
          width: { ideal: 640, max: 960 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 24 },
        } : false,
      }),
      fetchRtcIceServers,
      isCurrent,
    );
    ownedLocalStreamRef.current = stream;
    const peer = new RTCPeerConnection({
      iceServers,
    });
    stream.getTracks().forEach((track) => {
      const sender = peer.addTrack(track, stream);
      if (track.kind !== 'video') return;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = 900_000;
      parameters.encodings[0].maxFramerate = 24;
      parameters.degradationPreference = 'maintain-framerate';
      sender.setParameters(parameters).catch(() => {});
    });
    peer.ontrack = ({ streams, track }) => {
      if (!isCurrent()) return;
      if (streams[0]) {
        setRemoteStream(streams[0]);
        return;
      }
      setRemoteStream((current) => {
        const next = current || new MediaStream();
        if (!next.getTracks().some((item) => item.id === track.id)) next.addTrack(track);
        return next;
      });
    };
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && isCurrent()) publishSignal(call.id, 'ice', candidate.toJSON()).catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (!isCurrent()) return;
      if (peer.connectionState === 'connected') {
        setCallConnectionState('connected');
        setConnectedAt((value) => value || Date.now());
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (peer.connectionState === 'disconnected' && !disconnectTimerRef.current) {
        setCallConnectionState('reconnecting');
        disconnectTimerRef.current = window.setTimeout(() => {
          respondCall(call.id, 'ended').catch(() => {});
          cleanupCall();
        }, 15_000);
      }
      if (peer.connectionState === 'failed') {
        setCallConnectionState('failed');
        respondCall(call.id, 'ended').catch(() => {});
        cleanupCall();
      }
    };
    peerRef.current = peer;
    setMicrophoneEnabled(stream.getAudioTracks().some((track) => track.enabled));
    setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));
    setRemoteVideoReady(false);
    setCallConnectionState('connecting');
    setCallSeconds(0);
    setLocalStream(stream);
    setActiveCall(call);
    activeCallRef.current = call;
    incomingCallRef.current = null;
    await signalQueue.drain(processSignal);
    if (!isCurrent()) throw new DOMException('Call cancelled', 'AbortError');
    if (caller) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!isCurrent()) throw new DOMException('Call cancelled', 'AbortError');
      await publishSignal(call.id, 'offer', offer);
      await waitForRemoteDescription(call.id);
    }
  }, [cleanupCall, processSignal, signalQueue, waitForRemoteDescription]);

  const processCall = useCallback((call) => {
    if (!call?.id) return;
    if (terminalCallStates.has(call.status)) {
      if (activeCallRef.current?.id === call.id) cleanupCall();
      if (incomingCallRef.current?.id === call.id) incomingCallRef.current = null;
      setIncomingCall((current) => current?.id === call.id ? null : current);
      return;
    }
    if (call.recipient_id === currentUser.id && call.status === 'ringing' && !activeCallRef.current && (!incomingCallRef.current || incomingCallRef.current.id === call.id)) {
      const caller = drivers.find((driver) => driver.id === call.initiator_id);
      if (caller) setSelectedDriverId(caller.id);
      incomingCallRef.current = call;
      setIncomingCall(call);
    }
    if (activeCallRef.current?.id === call.id) {
      activeCallRef.current = call;
      setActiveCall(call);
    }
  }, [cleanupCall, currentUser.id, drivers]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeCalls({
      onCall: processCall,
      onSignal: (signal) => handleSignal(signal).catch((signalError) => setError(signalError.message)),
    });
    fetchRingingCalls()
      .then((calls) => {
        if (cancelled) return;
        calls.forEach(processCall);
      })
      .catch((callError) => {
        if (!cancelled) setError(callError.message || 'Qo‘ng‘iroqlarni tekshirib bo‘lmadi.');
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [handleSignal, processCall]);

  useEffect(() => {
    fetchRtcIceServers().catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let subscription = null;
    const isCurrent = conversationScope.begin();
    conversationCurrentRef.current = isCurrent;
    uploadAbortRef.current?.abort();
    if (recorderRef.current?.state === 'recording') { recorderRef.current.onstop = null; recorderRef.current.stop(); }
    recordingScopeRef.current += 1;
    stopMediaStream(recordingStreamRef.current);
    recordingStreamRef.current = null;
    // oxlint-disable-next-line react/set-state-in-effect -- external conversation selection resets owned upload and recorder state.
    setRecording(false);
    setSending(false);
    setLoadingOlder(false);
    setInputMessage('');
    setFailedUpload(null);
    setUploadProgress(null);
    if (!selectedDriver?.id) return undefined;
    // oxlint-disable-next-line react/set-state-in-effect -- selection starts a new external conversation request.
    setLoading(true);
    setError('');
    setMessages([]);
    setHasOlderMessages(false);
    setConversationId(null);
    setConnectionStatus('connecting');
    (async () => {
      try {
        const id = await openChat(selectedDriver.id);
        if (cancelled) return;
        setConversationId(id);
        const reconcileLatest = async () => {
          const page = await fetchChatMessages(id);
          if (cancelled || !isCurrent()) return;
          setMessages((previous) => mergeChatMessages(previous, page.messages));
          setHasOlderMessages(page.hasMore);
        };
        subscription = subscribeChat({
          conversationId: id,
          onStatus: (status) => {
            if (!isCurrent()) return;
            if (status === 'SUBSCRIBED') setConnectionStatus('connected');
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('offline');
            else if (status === 'CLOSED') setConnectionStatus('offline');
          },
          onReconnect: () => reconcileLatest().catch(() => { if (isCurrent()) setConnectionStatus('offline'); }),
          onMessage: (message) => {
            if (!isCurrent()) return;
            setMessages((previous) => mergeChatMessages(previous, [message]));
            if (visibilityRef.current && message.sender_id !== currentUser.id) {
              markChatRead(id).then(() => unreadChangeRef.current?.()).catch(() => {});
            } else {
              unreadChangeRef.current?.();
            }
          },
          onMessageUpdated: (message) => {
            if (!isCurrent()) return;
            setMessages((previous) => mergeChatMessages(previous, [message]));
            unreadChangeRef.current?.();
          },
        });
        await subscription.ready;
        await reconcileLatest();
        if (!isCurrent()) return;
        if (visibilityRef.current) {
          await markChatRead(id);
          unreadChangeRef.current?.();
        }
      } catch (loadError) {
        if (!cancelled) {
          setConnectionStatus('offline');
          setError(loadError.message || 'Chatni ochib bo‘lmadi.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; conversationScope.cancel(); subscription?.unsubscribe(); };
  }, [selectedDriver?.id, currentUser.id, conversationScope]);

  useEffect(() => {
    if (isVisible) return;
    recordingScopeRef.current += 1;
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    }
    stopMediaStream(recordingStreamRef.current);
    recordingStreamRef.current = null;
    // oxlint-disable-next-line react/set-state-in-effect -- hide discards an owned microphone recording.
    setRecording(false);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !conversationId) return;
    const isCurrent = conversationCurrentRef.current;
    fetchChatMessages(conversationId).then(async (page) => {
      if (!isCurrent() || !visibilityRef.current) return;
      setMessages((previous) => mergeChatMessages(previous, page.messages));
      await markChatRead(conversationId);
      unreadChangeRef.current?.();
    }).catch((cause) => { if (isCurrent()) setError(cause.message); });
  }, [isVisible, conversationId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize externally requested driver navigation.
    if (activeChatDriver?.id) setSelectedDriverId(activeChatDriver.id);
  }, [activeChatDriver?.id, selectionRequestKey]);

  useEffect(() => {
    const call = activeCall?.status === 'accepted' ? activeCall : null;
    if (!call) return undefined;
    heartbeatCall(call.id).catch(() => {});
    const timer = window.setInterval(() => heartbeatCall(call.id).catch(() => {}), 20_000);
    return () => window.clearInterval(timer);
  }, [activeCall]);

  useEffect(() => () => {
    const call = activeCallRef.current;
    if (call) respondCall(call.id, 'ended').catch(() => {});
    cleanupCall();
    conversationScope.cancel();
    uploadAbortRef.current?.abort();
    recordingScopeRef.current += 1;
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    }
    stopMediaStream(recordingStreamRef.current);
  }, [cleanupCall, conversationScope]);

  const sendMessage = async (event) => {
    event?.preventDefault();
    if (!conversationId || !inputMessage.trim() || sending) return;
    const isCurrent = conversationCurrentRef.current;
    const text = inputMessage.trim();
    setInputMessage('');
    setSending(true);
    try {
      const message = await sendTextMessage(conversationId, text);
      if (isCurrent()) setMessages((previous) => mergeChatMessages(previous, [message]));
    } catch (sendError) {
      if (!isCurrent()) return;
      setInputMessage((draft) => draft ? `${text}\n${draft}` : text);
      setError(sendError.message || 'Xabar yuborilmadi.');
    } finally {
      if (isCurrent()) setSending(false);
    }
  };

  const uploadFile = async (file, durationMs = null) => {
    if (!file || !conversationId || uploadAbortRef.current) return;
    const isCurrent = conversationCurrentRef.current;
    if (file.size > 50 * 1024 * 1024) {
      setError('Fayl hajmi 50 MB dan oshmasligi kerak.');
      return;
    }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setSending(true);
    setUploadProgress(0);
    setFailedUpload(null);
    setError('');
    try {
      const message = await sendMediaMessage({
        conversationId,
        file,
        durationMs,
        signal: controller.signal,
        onProgress: (progress) => { if (isCurrent()) setUploadProgress(progress); },
      });
      if (isCurrent()) setMessages((previous) => mergeChatMessages(previous, [message]));
    } catch (uploadError) {
      if (isCurrent() && uploadError.name !== 'AbortError') {
        setFailedUpload({ file, durationMs, conversationId });
        setError(uploadError.message || 'Media yuborilmadi.');
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (isCurrent()) { setUploadProgress(null); setSending(false); }
    }
  };

  const loadOlderMessages = async () => {
    if (!conversationId || loadingOlder || !hasOlderMessages) return;
    const isCurrent = conversationCurrentRef.current;
    setLoadingOlder(true);
    try {
      const page = await fetchChatMessages(conversationId, { before: buildChatCursor(messages) });
      if (!isCurrent()) return;
      setMessages((previous) => mergeChatMessages(previous, page.messages));
      setHasOlderMessages(page.hasMore);
    } catch (loadError) {
      if (!isCurrent()) return;
      setError(loadError.message || 'Eski xabarlar yuklanmadi.');
    } finally {
      if (isCurrent()) setLoadingOlder(false);
    }
  };

  const refreshMedia = async (message) => {
    const isCurrent = conversationCurrentRef.current;
    try {
      const refreshed = await refreshChatMessageMedia(message);
      if (isCurrent()) setMessages((current) => mergeChatMessages(current, [refreshed]));
    } catch (refreshError) {
      if (isCurrent()) setError(refreshError.message || 'Mediani qayta yuklab bo‘lmadi.');
      throw refreshError;
    }
  };

  const removeMessage = async (message) => {
    if (message.sender_id !== currentUser.id) return;
    if (!window.confirm('Xabarni ikkala tomondan o‘chirasizmi?')) return;
    const isCurrent = conversationCurrentRef.current;
    setError('');
    try {
      await deleteChatMessage(message);
      if (isCurrent()) setMessages((previous) => previous.filter((item) => item.id !== message.id));
      unreadChangeRef.current?.();
    } catch (deleteError) {
      if (isCurrent()) setError(deleteError.message || 'Xabar o‘chirilmadi.');
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (recorderRef.current?.state === 'recording' || sending) return;
    const scope = ++recordingScopeRef.current;
    const isCurrent = conversationCurrentRef.current;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (scope !== recordingScopeRef.current || !isCurrent()) { stopMediaStream(stream); return; }
      recordingStreamRef.current = stream;
      const options = MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined;
      const recorder = new MediaRecorder(stream, options);
      recorderChunksRef.current = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) recorderChunksRef.current.push(data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        if (scope !== recordingScopeRef.current || !isCurrent()) return;
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        await uploadFile(file, Date.now() - recordingStartedRef.current);
      };
      recorderRef.current = recorder;
      recordingStartedRef.current = Date.now();
      recorder.start(250);
      setRecording(true);
    } catch (recordError) {
      stopMediaStream(stream);
      if (!isCurrent()) return;
      setError(recordError.message || 'Mikrofonga ruxsat berilmadi.');
    }
  };

  const placeCall = async (kind) => {
    if (!conversationId || callStartingRef.current || activeCallRef.current || incomingCallRef.current) return;
    callStartingRef.current = true;
    const isCurrent = callScope.begin();
    let call;
    try {
      setError('');
      call = await startCall(conversationId, kind);
      if (!isCurrent()) { await respondCall(call.id, 'ended').catch(() => {}); return; }
      activeCallRef.current = call;
      setActiveCall(call);
      await preparePeer(call, true, isCurrent);
    } catch (callError) {
      if (call) await respondCall(call.id, 'ended').catch(() => {});
      if (isCurrent()) {
        cleanupCall();
        if (callError.name !== 'AbortError') setError(callError.message || 'Qo‘ng‘iroq boshlanmadi.');
      }
    } finally {
      if (isCurrent()) callStartingRef.current = false;
    }
  };

  const acceptIncomingCall = async () => {
    const call = incomingCallRef.current;
    if (!call || callStartingRef.current) return;
    callStartingRef.current = true;
    const isCurrent = callScope.begin();
    activeCallRef.current = call;
    incomingCallRef.current = null;
    setActiveCall(call);
    setIncomingCall(null);
    try {
      setError('');
      await preparePeer(call, false, isCurrent);
      await waitForRemoteDescription(call.id, 20_000);
      if (!isCurrent()) return;
      const accepted = await respondCall(call.id, 'accepted');
      if (!isCurrent()) return;
      activeCallRef.current = accepted;
      setActiveCall(accepted);
    } catch (callError) {
      await respondCall(call.id, 'ended').catch(() => {});
      if (isCurrent()) {
        cleanupCall();
        if (callError.name !== 'AbortError') setError(callError.message || 'Qo‘ng‘iroqqa ulanib bo‘lmadi.');
      }
    } finally {
      if (isCurrent()) callStartingRef.current = false;
    }
  };

  const declineIncomingCall = () => {
    const call = incomingCallRef.current;
    cleanupCall();
    if (call) respondCall(call.id, 'declined').catch(() => {});
  };

  const endCall = () => {
    const call = activeCallRef.current;
    cleanupCall();
    if (call) respondCall(call.id, 'ended').catch(() => {});
  };

  const toggleMicrophone = () => {
    const tracks = localStream?.getAudioTracks() || [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => { track.enabled = enabled; });
    setMicrophoneEnabled(enabled);
  };

  const toggleCamera = () => {
    const tracks = localStream?.getVideoTracks() || [];
    if (!tracks.length || screenSharing) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => { track.enabled = enabled; });
    setCameraEnabled(enabled);
  };

  const stopScreenShare = useCallback(async () => {
    const cameraTrack = localStream?.getVideoTracks()[0];
    const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack).catch(() => {});
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
  }, [localStream]);

  const toggleScreenShare = async () => {
    if (screenSharing) {
      await stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Bu brauzer ekran ulashishni qo‘llamaydi.');
      return;
    }
    const callId = activeCallRef.current?.id;
    const currentPeer = peerRef.current;
    let displayStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (!callId || activeCallRef.current?.id !== callId || peerRef.current !== currentPeer) { stopMediaStream(displayStream); return; }
      const displayTrack = displayStream.getVideoTracks()[0];
      const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (!displayTrack || !sender) {
        displayStream.getTracks().forEach((track) => track.stop());
        throw new Error('Video uzatgich topilmadi.');
      }
      await sender.replaceTrack(displayTrack);
      if (activeCallRef.current?.id !== callId || peerRef.current !== currentPeer) { stopMediaStream(displayStream); return; }
      screenStreamRef.current = displayStream;
      displayTrack.onended = () => { stopScreenShare().catch(() => {}); };
      setScreenSharing(true);
    } catch (shareError) {
      stopMediaStream(displayStream);
      if (shareError.name !== 'NotAllowedError') setError(shareError.message || 'Ekran ulashilmadi.');
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await callOverlayRef.current?.requestFullscreen?.();
    } catch (cause) { setError(cause.message || 'To‘liq ekran ochilmadi.'); }
  };

  if (!selectedDriver) {
    return <div className="dispatch-chat-workspace h-full grid place-items-center text-zinc-500">Chat uchun haydovchi topilmadi.</div>;
  }

  return (
    <Fragment>
    <div className={`${isVisible ? 'grid' : 'hidden'} grid-rows-[minmax(0,1fr)] relative overflow-hidden bg-white dark:bg-zinc-950 ${
      compact
        ? `h-full min-h-0 w-full grid-cols-1 ${showProfile ? 'lg:grid-cols-[minmax(0,1fr)_250px]' : ''}`
        : `dispatch-chat-workspace grid-cols-1 h-full min-h-0 md:grid-cols-[300px_minmax(0,1fr)] ${showProfile ? 'lg:grid-cols-[280px_minmax(0,1fr)_250px]' : ''}`
    }`}>
      {!compact && <aside className="hidden min-h-0 md:flex border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950 flex-col">
        <div className="h-16 shrink-0 px-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
          <label className="flex h-10 w-full items-center gap-2 rounded-xl bg-zinc-200/70 px-3 text-zinc-500 dark:bg-zinc-800">
            <Search className="h-4 w-4 shrink-0" />
            <input
              type="search"
              value={driverSearch}
              onChange={(event) => setDriverSearch(event.target.value)}
              placeholder="Chatlarni qidirish"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-white"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredDrivers.map((driver) => {
            const selected = driver.id === selectedDriver.id;
            return (
              <button
                key={driver.id}
                onClick={() => {
                  setSelectedDriverId(driver.id);
                  setMessageSearch('');
                  setMediaFilter('all');
                }}
                className={`w-full p-4 flex gap-3 text-left border-b border-zinc-200/70 dark:border-zinc-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/25' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
              >
                <DriverAvatar driver={driver} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{driver.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{driver.driverNumber} · {driver.truck}</p>
                  <p className="text-xs text-zinc-400 truncate mt-1">{selected ? messagePreview(messages[messages.length - 1]) : 'Suhbatni ochish'}</p>
                </div>
              </button>
            );
          })}
          {filteredDrivers.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">Mos chat topilmadi.</div>
          )}
        </div>
      </aside>}

      <section className="flex min-h-0 min-w-0 flex-col bg-[radial-gradient(circle_at_top,#eef6ff_0,transparent_55%)] dark:bg-none dark:bg-zinc-900/30">
        <header className="h-16 shrink-0 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-between">
          {showMessageSearch ? (
            <div className="mr-3 flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-800">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                autoFocus
                type="search"
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Xabarlardan qidirish"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <button type="button" onClick={() => { setShowMessageSearch(false); setMessageSearch(''); }} title="Qidiruvni yopish" className="rounded-full p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowProfile(true)} className="flex min-w-0 items-center gap-3 text-left">
              <DriverAvatar driver={selectedDriver} sizeClass="w-10 h-10" />
              <span className="min-w-0">
                <span className="block truncate font-black">{selectedDriver.name}</span>
                <span className={`block text-xs font-semibold ${connectionStatus === 'connected' ? (selectedDriver.isOnline ? 'text-emerald-500' : 'text-zinc-400') : 'text-amber-600'}`}>
                  {connectionStatus === 'connected' ? (selectedDriver.isOnline ? 'Onlayn' : 'Oflayn') : connectionStatus === 'connecting' ? 'Ulanmoqda…' : 'Qayta ulanmoqda…'}
                </span>
              </span>
            </button>
          )}
          <div className="flex items-center gap-1">
            {!showMessageSearch && <button type="button" onClick={() => setShowMessageSearch(true)} title="Xabarlardan qidirish" className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"><Search className="w-5 h-5" /></button>}
            <button onClick={() => placeCall('audio')} title="Audio qo‘ng‘iroq" className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-blue-600"><Phone className="w-5 h-5" /></button>
            <button onClick={() => placeCall('video')} title="Video qo‘ng‘iroq" className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-blue-600"><Video className="w-5 h-5" /></button>
            <button type="button" aria-pressed={showProfile} onClick={() => setShowProfile((current) => !current)} title="Driver ma’lumotlari" className={`p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${showProfile ? 'text-blue-600' : 'text-zinc-500'}`}><PanelRight className="w-5 h-5" /></button>
            {compact && <button onClick={onClose} title="Chatni yopish" className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"><X className="w-5 h-5" /></button>}
          </div>
        </header>

        {mediaFilter !== 'all' && (
          <div className="flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950/80">
            <span className="font-bold text-zinc-700 dark:text-zinc-200">{({ image: 'Rasmlar', video: 'Videolar', file: 'Fayllar', audio: 'Audio', links: 'Havolalar' })[mediaFilter]}</span>
            <button type="button" onClick={() => setMediaFilter('all')} className="font-bold text-blue-600">Barchasini ko‘rsatish</button>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">
            <span>{error}</span>
            {failedUpload?.conversationId === conversationId && <button type="button" onClick={() => uploadFile(failedUpload.file, failedUpload.durationMs)} className="shrink-0 font-black underline">Qayta yuborish</button>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-2">
          {loading && <div className="h-full grid place-items-center"><LoaderCircle className="animate-spin text-blue-600" /></div>}
          {!loading && hasOlderMessages && (
            <div className="flex justify-center pb-2">
              <button type="button" disabled={loadingOlder} onClick={loadOlderMessages} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {loadingOlder ? 'Yuklanmoqda…' : 'Eski xabarlarni yuklash'}
              </button>
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="h-full grid place-items-center text-center text-zinc-500">
              <div><div className="text-5xl mb-3">👋</div><p className="font-black text-zinc-800 dark:text-zinc-100">Suhbatni boshlang</p><p className="text-sm">Xabar, rasm, video yoki ovoz yuboring.</p></div>
            </div>
          )}
          {!loading && messages.length > 0 && visibleMessages.length === 0 && (
            <div className="h-full grid place-items-center text-center text-zinc-500">
              <div><Search className="mx-auto mb-3 h-8 w-8" /><p className="font-bold">Mos xabar topilmadi.</p></div>
            </div>
          )}
          {visibleMessages.map((message, index) => {
            const mine = message.sender_id === currentUser.id;
            const showDate = index === 0 || messageDayKey(message.created_at) !== messageDayKey(visibleMessages[index - 1].created_at);
            return (
              <Fragment key={message.id}>
                {showDate && (
                  <div className="sticky top-1 z-10 flex justify-center py-2">
                    <span className="rounded-full bg-zinc-800/75 px-3 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur dark:bg-zinc-700/85">{messageDayLabel(message.created_at)}</span>
                  </div>
                )}
                <div className={`group flex items-center gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                  {mine && <button type="button" onClick={() => removeMessage(message)} title="Xabarni o‘chirish" className="p-1.5 rounded-full text-zinc-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"><Trash2 className="w-4 h-4" /></button>}
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 shadow-sm ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-bl-md'}`}>
                    {message.kind === 'text' ? <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p> : <MediaMessage message={message} onRefresh={refreshMedia} />}
                    <div className={`mt-1 text-[10px] flex items-center justify-end gap-1 ${mine ? 'text-blue-100' : 'text-zinc-400'}`}>
                      <span>{messageTime(message.created_at)}</span>
                      {mine && <CheckCheck className={`w-3.5 h-3.5 ${message.read_at ? 'text-cyan-200' : ''}`} />}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {uploadProgress !== null && (
          <div className="border-t border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950" aria-live="polite">
            <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-zinc-500"><span>Media yuborilmoqda</span><button type="button" onClick={() => uploadAbortRef.current?.abort()} className="text-red-600">Bekor qilish</button></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(uploadProgress * 100)}%` }} /></div>
          </div>
        )}
        <form onSubmit={sendMessage} className="relative shrink-0 px-3 py-3 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-end gap-2">
          <input ref={fileInputRef} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf" onChange={(event) => { uploadFile(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Media yuborish" className="p-2.5 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Paperclip className="w-5 h-5" /></button>
          <div className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3">
            <textarea ref={composerRef} rows="1" value={inputMessage} onChange={(event) => setInputMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Xabar yozing…" className="w-full max-h-28 resize-none bg-transparent py-2.5 text-sm outline-none" />
          </div>
          <button type="button" onClick={() => setShowEmojiPicker((current) => !current)} title="Emoji" className="p-2.5 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Smile className="w-5 h-5" /></button>
          {inputMessage.trim() ? (
            <button type="submit" disabled={sending} className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">{sending ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}</button>
          ) : (
            <button type="button" onClick={toggleRecording} title="Ovozli xabar" className={`p-2.5 rounded-full text-white ${recording ? 'bg-red-600 animate-pulse' : 'bg-blue-600'}`}>{recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
          )}
          {showEmojiPicker && (
            <div className="absolute bottom-[calc(100%+8px)] right-14 flex flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              {['😀', '👍', '✅', '🚛', '📍', '📄', '🙏', '🔥'].map((emoji) => (
                <button key={emoji} type="button" onClick={() => { setInputMessage((current) => `${current}${emoji}`); setShowEmojiPicker(false); composerRef.current?.focus(); }} className="grid h-9 w-9 place-items-center rounded-lg text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800">{emoji}</button>
              ))}
            </div>
          )}
        </form>
      </section>

      {showProfile && (
        <>
        <button type="button" aria-label="Driver ma’lumotlari panelini yopish" onClick={() => setShowProfile(false)} className="absolute inset-0 z-20 bg-zinc-950/25 backdrop-blur-[1px] lg:hidden" />
        <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(300px,calc(100%-1rem))] min-w-0 flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 lg:static lg:w-auto lg:shadow-none">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
            <p className="font-black">Driver ma’lumotlari</p>
            <button type="button" onClick={() => setShowProfile(false)} title="Panelni yopish" className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="border-b border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
              <div className="mx-auto w-fit"><DriverAvatar driver={selectedDriver} sizeClass="w-20 h-20" /></div>
              <h3 className="mt-3 truncate text-lg font-black">{selectedDriver.name}</h3>
              <p className={`mt-1 text-xs font-semibold ${selectedDriver.isOnline ? 'text-emerald-500' : 'text-zinc-400'}`}>{selectedDriver.isOnline ? 'Onlayn' : 'Oflayn'}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => placeCall('audio')} className="rounded-xl bg-zinc-100 px-2 py-3 text-xs font-bold hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"><Phone className="mx-auto mb-1 h-5 w-5 text-blue-600" />Audio</button>
                <button type="button" onClick={() => placeCall('video')} className="rounded-xl bg-zinc-100 px-2 py-3 text-xs font-bold hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"><Video className="mx-auto mb-1 h-5 w-5 text-blue-600" />Video</button>
              </div>
            </div>

            <div className="space-y-4 border-b border-zinc-200 px-4 py-5 text-sm dark:border-zinc-800">
              <div className="flex items-start gap-3"><Phone className="mt-0.5 h-4 w-4 text-zinc-400" /><div className="min-w-0"><p className="break-all font-semibold">{selectedDriver.phone || 'Telefon kiritilmagan'}</p><p className="text-xs text-zinc-500">Telefon</p></div></div>
              <div className="flex items-start gap-3"><UserRound className="mt-0.5 h-4 w-4 text-zinc-400" /><div><p className="font-semibold">{selectedDriver.driverNumber}</p><p className="text-xs text-zinc-500">Driver ID</p></div></div>
            </div>

            <div className="py-2">
              {[
                ['image', 'Rasmlar', ImageIcon, mediaStats.image],
                ['video', 'Videolar', Video, mediaStats.video],
                ['file', 'Fayllar', FileText, mediaStats.file],
                ['audio', 'Audio', Music2, mediaStats.audio],
                ['links', 'Havolalar', Link2, mediaStats.links],
              ].map(([filter, label, Icon, count]) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setMediaFilter((current) => current === filter ? 'all' : filter)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 ${mediaFilter === filter ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : ''}`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="flex-1 text-left font-semibold">{label}</span>
                  <span className="font-bold text-zinc-500">{count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
        </>
      )}

    </div>

      {incomingCall && createPortal(
        <CallDialog label="Kiruvchi qo‘ng‘iroq"><div className="fixed inset-0 z-[100] bg-zinc-950/80 backdrop-blur flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center text-white">
            <div className="w-24 h-24 mx-auto rounded-full bg-blue-600 grid place-items-center text-4xl font-black shadow-2xl">{callDriver?.name?.charAt(0) || '?'}</div>
            <h3 className="mt-5 text-2xl font-black">{callDriver?.name || 'Haydovchi'}</h3>
            <p className="text-zinc-300 mt-1">Kiruvchi {incomingCall.kind === 'video' ? 'video' : 'audio'} qo‘ng‘iroq</p>
            <div className="mt-8 flex justify-center gap-8">
              <button onClick={declineIncomingCall} aria-label="Qo‘ng‘iroqni rad etish" className="w-16 h-16 rounded-full bg-red-600 grid place-items-center"><PhoneOff /></button>
              <button onClick={acceptIncomingCall} aria-label="Qo‘ng‘iroqni qabul qilish" className="w-16 h-16 rounded-full bg-emerald-500 grid place-items-center"><Phone /></button>
            </div>
          </div>
        </div></CallDialog>, document.body
      )}

      {activeCall && createPortal(
        <CallDialog label="Faol qo‘ng‘iroq"><div ref={callOverlayRef} className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#191d22] text-white">
          {activeCall.kind === 'audio' && <audio ref={attachRemoteVideo} autoPlay />}
          {playbackBlocked && <button type="button" onClick={() => remoteVideoRef.current?.play().then(() => setPlaybackBlocked(false)).catch(() => {})} className="absolute left-4 top-4 z-30 rounded-lg bg-blue-600 px-4 py-2">Ovozni yoqish</button>}
          <header className="relative z-20 flex min-h-[118px] shrink-0 items-center justify-center px-5 pt-5 text-center sm:min-h-[136px]">
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xl font-black shadow-lg ring-2 ring-white/10">
                {callDriver?.avatar ? <img src={callDriver.avatar} alt="" className="h-full w-full object-cover" /> : callDriver?.name?.charAt(0) || '?'}
              </div>
              <h2 className="mt-2 text-lg font-bold leading-tight">{callDriver?.name || 'Haydovchi'}</h2>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                {callConnectionState === 'connected'
                  ? `${callDuration(callSeconds)} · Himoyalangan`
                  : callConnectionState === 'reconnecting'
                    ? 'Qayta ulanmoqda…'
                    : callConnectionState === 'failed'
                      ? 'Ulanish uzildi'
                      : 'Shifrlangan ulanish o‘rnatilmoqda…'}
              </p>
            </div>
            <button type="button" onClick={toggleFullscreen} title="To‘liq ekran" className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white">
              <Maximize2 className="h-5 w-5" />
            </button>
          </header>

          <main className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-8">
            <div className={`relative flex h-full max-h-[min(68vh,720px)] w-full max-w-5xl items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#101318] shadow-2xl ${activeCall.kind === 'video' ? 'aspect-video' : 'max-w-2xl'}`}>
              {activeCall.kind === 'video' && remoteStream && (
                <video
                  ref={attachRemoteVideo}
                  autoPlay
                  playsInline
                  onLoadedData={() => setRemoteVideoReady(true)}
                  onPlaying={() => setRemoteVideoReady(true)}
                  className="absolute inset-0 h-full w-full bg-black object-contain"
                />
              )}

              {(activeCall.kind !== 'video' || !remoteVideoReady) && (
                <div className="relative z-10 px-6 text-center">
                  <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-5xl font-black shadow-2xl ring-4 ring-white/10">
                    {callDriver?.avatar ? <img src={callDriver.avatar} alt="" className="h-full w-full object-cover" /> : callDriver?.name?.charAt(0) || '?'}
                  </div>
                  <h3 className="mt-5 text-2xl font-bold">{callDriver?.name || 'Haydovchi'}</h3>
                  <p className="mt-2 text-sm text-zinc-400">{callConnectionState === 'connected' ? (activeCall.kind === 'video' ? 'Video kutilmoqda…' : 'Audio qo‘ng‘iroq') : 'Ulanmoqda…'}</p>
                </div>
              )}

              {screenSharing && (
                <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-blue-600/90 px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur">
                  <MonitorUp className="h-4 w-4" /> Ekran uzatilmoqda
                </div>
              )}

              {activeCall.kind === 'video' && (
                <div className="absolute right-3 top-3 z-20 aspect-[3/4] w-24 overflow-hidden rounded-xl border border-white/20 bg-zinc-900 shadow-2xl sm:right-4 sm:top-4 sm:w-36">
                  <video ref={attachLocalVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${cameraEnabled ? '' : 'invisible'}`} />
                  {!cameraEnabled && <div className="absolute inset-0 grid place-items-center"><VideoOff className="h-6 w-6 text-zinc-400" /></div>}
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold">Siz</span>
                </div>
              )}
            </div>
          </main>

          <footer className="relative z-20 flex min-h-[118px] shrink-0 items-center justify-center px-4 pb-4 pt-5 sm:min-h-[136px]">
            <div className="flex items-start justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 shadow-xl backdrop-blur sm:gap-5 sm:px-6">
              {activeCall.kind === 'video' && <CallControl icon={MonitorUp} label={screenSharing ? 'Ulashishni to‘xtatish' : 'Ekran'} active={screenSharing} disabled={!localStream} onClick={toggleScreenShare} />}
              {activeCall.kind === 'video' && <CallControl icon={cameraEnabled ? Video : VideoOff} label={cameraEnabled ? 'Kamerani o‘chirish' : 'Kamerani yoqish'} active={!cameraEnabled} disabled={screenSharing || !localStream} onClick={toggleCamera} />}
              <CallControl icon={PhoneOff} label="Yakunlash" danger onClick={endCall} />
              <CallControl icon={microphoneEnabled ? Mic : MicOff} label={microphoneEnabled ? 'Mikrofonni o‘chirish' : 'Mikrofonni yoqish'} active={!microphoneEnabled} disabled={!localStream} onClick={toggleMicrophone} />
              <CallControl icon={Maximize2} label="To‘liq ekran" onClick={toggleFullscreen} />
            </div>
          </footer>
          <p className="pointer-events-none absolute bottom-2 left-4 hidden text-[10px] text-zinc-600 lg:block">DRIVEX qo‘ng‘irog‘i</p>
        </div></CallDialog>, document.body
      )}
    </Fragment>
  );
}
