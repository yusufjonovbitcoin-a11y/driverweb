import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { OperationScope, acquireCallMedia, stopMediaStream } from '../services/chatAsyncSafety';
import React, { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check, CheckCheck, Clock3, Download, FileText, Image as ImageIcon, Link2, LoaderCircle,
  Mail, Maximize2, Mic, MicOff, MonitorUp, Music2, PanelRight, Paperclip, Pencil, Phone, PhoneOff,
  Search, Send, ShieldCheck, Smile, Square, Trash2, UserRound, Video, VideoOff, X,
} from 'lucide-react';
import {
  clearChatUnread, deleteChatMessage, editChatMessage, fetchCallSignals, fetchChatMessages, fetchChatPreviews, fetchRingingCalls, fetchRtcIceServers, fetchUnreadChatCountsByDriver, heartbeatCall, hydrateChatMessageMedia, markChatUnread, openChat, refreshChatMessageMedia, syncChatHistory, searchChatMessages, fetchChatMediaCounts,
  publishSignal, respondCall, sendMediaMessage, sendTextMessage, startCall, subscribeCalls, subscribeChat, subscribeChatPreviews,
} from '../services/chatService';
import { buildChatCursor, mergeChatMessages } from '../services/chatReliability';
import { RtcSignalQueue } from '../services/rtcSignalQueue';
import { formatDate, formatDateTime, formatTime } from '../i18n/format';
import { displayDayKey, relativeDisplayDay } from '../i18n/timeZone.js';
import { localizedError } from '../i18n/errors';
import { positionChatContextMenu } from './chatContextMenu';
import ChatTimeline, { ChatReadBoundary } from './ChatTimeline';
import { useChatReadReceipts } from '../hooks/useChatReadReceipts';
import { chatAccountKey, ChatOutbox, ChatSessionCache } from '../services/chatSession';
import { ChatSearchScope } from '../services/chatSubscription';
import { ChatMediaOutbox } from '../services/chatMediaOutbox';
import { openChatAttachment } from '../services/openChatAttachment';
import { createChatRecovery } from '../services/chatRecovery';
import { ChatPaginationScope } from '../services/chatPaginationScope';
import { Virtuoso } from 'react-virtuoso';

const terminalCallStates = new Set(['declined', 'missed', 'ended']);

function messageTime(value) {
  return formatTime(value);
}

function messageDayKey(value) {
  return displayDayKey(value);
}

function messageDayLabel(value, t) {
  const relative = relativeDisplayDay(value);
  if (relative === 'today') return t('common.today');
  if (relative === 'yesterday') return t('common.yesterday');
  return formatDate(value, { day: 'numeric', month: 'long' });
}

function messagePreview(message, t) {
  if (!message) return t('chat.newConversation');
  if (message.kind === 'text') return message.body;
  return { image: t('common.image'), video: t('common.video'), audio: t('common.audio'), file: t('common.file') }[message.kind] || t('common.message');
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
  const { t } = useTranslation();
  return (
    <div className={`relative ${sizeClass} flex-none`}>
      <div className="h-full w-full overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white grid place-items-center font-black">
        {driver.avatar ? (
          <img src={driver.avatar} alt={t('chat.avatarAlt', { name: driver.name })} className="h-full w-full object-cover" />
        ) : driver.name?.charAt(0)}
      </div>
      {driver.isOnline && <span className="absolute right-0 bottom-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-950" />}
    </div>
  );
}

function MediaMessage({ message, onRefresh }) {
  const { t } = useTranslation();
  const attemptsRef = useRef(0);
  const [failed, setFailed] = useState(false);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (message.kind === 'file' || message.mediaUrl) return;
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect -- begin an external media URL request for a newly mounted viewport row.
    setRecovering(true);
    onRefresh(message, false).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setRecovering(false); });
    return () => { active = false; };
  }, [message, onRefresh]);
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
  if (message.kind === 'file') {
    return <button type="button" disabled={recovering} onClick={async () => {
      setRecovering(true); setFailed(false);
      try { await openChatAttachment(message, (row) => onRefresh(row, true)); }
      catch { setFailed(true); }
      finally { setRecovering(false); }
    }} className="flex items-center gap-2 font-semibold underline disabled:opacity-60">
      <FileText className="w-5 h-5 shrink-0" />
      <span className="truncate">{recovering ? t('chat.mediaRefreshing') : failed ? t('chat.reloadMedia') : message.file_name || t('common.file')}</span>
      <Download className="w-4 h-4 shrink-0" />
    </button>;
  }
  if (!message.mediaUrl || failed) {
    return <button type="button" onClick={() => retry(true)} disabled={recovering} className="font-bold underline disabled:opacity-60">{recovering ? t('chat.mediaRefreshing') : t('chat.reloadMedia')}</button>;
  }
  if (message.kind === 'image') {
    return <img src={message.mediaUrl} onError={() => { void retry(); }} alt={message.file_name || t('chat.imageAlt')} className="max-h-72 rounded-2xl object-cover" />;
  }
  if (message.kind === 'video') {
    return <video src={message.mediaUrl} onError={() => { void retry(); }} controls playsInline preload="metadata" className="max-h-72 max-w-full rounded-2xl" />;
  }
  if (message.kind === 'audio') {
    return <audio src={message.mediaUrl} onError={() => { void retry(); }} controls preload="metadata" className="max-w-full h-10" />;
  }
  return (
    <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold underline">
      <FileText className="w-5 h-5" />
      <span className="truncate">{message.file_name || t('common.file')}</span>
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
  const { t } = useTranslation();
  const [selectedDriverId, setSelectedDriverId] = useState(activeChatDriver?.id || drivers[0]?.id || null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatCache] = useState(() => new ChatSessionCache(chatAccountKey(currentUser)));
  const [outbox] = useState(() => new ChatOutbox(chatAccountKey(currentUser)));
  const [pendingTexts, setPendingTexts] = useState(() => outbox.list());
  const [mediaOutbox] = useState(() => new ChatMediaOutbox(chatAccountKey(currentUser)));
  const [pendingMedia, setPendingMedia] = useState([]);
  const [searchScope] = useState(() => new ChatSearchScope());
  const [paginationScope] = useState(() => new ChatPaginationScope());
  const [searchRevision, setSearchRevision] = useState(0);
  const cacheDriverRef = useRef(null);
  const conversationIdRef = useRef(null);
  const [scrollSnapshot, setScrollSnapshot] = useState(null);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [driverPreviews, setDriverPreviews] = useState({});
  const [driverConversationIds, setDriverConversationIds] = useState({});
  const [driverUnreadCounts, setDriverUnreadCounts] = useState({});
  const [chatContextMenu, setChatContextMenu] = useState(null);
  const [markingUnreadDriverId, setMarkingUnreadDriverId] = useState(null);
  const [readPaused, setReadPaused] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [messageContextMenu, setMessageContextMenu] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
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
  const messagesRef = useRef([]);
  const syncRef = useRef(null);
  const [searchPage, setSearchPage] = useState({ messages: [], hasMore: false });
  const [searchLoading, setSearchLoading] = useState(false);
  const [mediaStats, setMediaStats] = useState({ image: 0, video: 0, audio: 0, file: 0, links: 0 });
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
  const driversRef = useRef(drivers);
  const translationRef = useRef(t);
  const callStartingRef = useRef(false);
  const contextMenuButtonRef = useRef(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [connectedAt, setConnectedAt] = useState(null);
  const recordingScopeRef = useRef(0);
  useLayoutEffect(() => {
    visibilityRef.current = isVisible;
    unreadChangeRef.current = onUnreadChange;
    driversRef.current = drivers;
    translationRef.current = t;
  }, [isVisible, onUnreadChange, drivers, t]);

  useLayoutEffect(() => { messagesRef.current = messages; conversationIdRef.current = conversationId; }, [messages, conversationId]);
  useLayoutEffect(() => {
    if (cacheDriverRef.current) chatCache.setDraft(cacheDriverRef.current, inputMessage);
  }, [chatCache, inputMessage]);
  const applyMessages = useCallback((rows, options) => {
    if (!cacheDriverRef.current) return;
    for (const row of rows) if (row.client_id && row.sender_id === currentUser.id) {
      outbox.acknowledge(row.client_id);
      if (row.kind !== 'text') void mediaOutbox.acknowledge(row.client_id).catch(() => {});
    }
    setPendingTexts(outbox.list());
    const next = chatCache.merge(cacheDriverRef.current, rows, options);
    setHasNewerMessages(Boolean(chatCache.get(cacheDriverRef.current).detached));
    messagesRef.current = next;
    setMessages(next);
  }, [chatCache, currentUser.id, outbox, mediaOutbox]);
  const saveScroll = useCallback((snapshot) => {
    for (const entry of chatCache.entries.values()) if (entry.conversationId === conversationId) entry.scroll = snapshot;
  }, [chatCache, conversationId]);
  useEffect(() => {
    const flush = () => chatCache.flush();
    const clear = ({ detail }) => { if (detail === chatAccountKey(currentUser)) { outbox.clear(); chatCache.close(); void mediaOutbox.clear().catch(() => {}); } };
    const otherTabLogout = () => {
      if (outbox.isCurrent()) return;
      outbox.closed = true; outbox.rows.clear(); chatCache.close(); mediaOutbox.close();
      setMessages([]); setPendingTexts([]); setInputMessage('');
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('drivex-chat-logout', clear);
    window.addEventListener('storage', otherTabLogout);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('drivex-chat-logout', clear); window.removeEventListener('storage', otherTabLogout); chatCache.flush(); };
  }, [chatCache, currentUser, outbox, mediaOutbox]);
  useEffect(() => {
    const off = mediaOutbox.subscribe(() => setPendingMedia(mediaOutbox.list()));
    const restore = async () => {
      try {
        await mediaOutbox.restore();
        for (const entry of chatCache.entries.values()) for (const row of entry.messages) {
          if (row.client_id && row.sender_id === currentUser.id && row.kind !== 'text') await mediaOutbox.acknowledge(row.client_id);
        }
      } catch { /* A new upload reports unavailable durable storage explicitly. */ }
    };
    void restore();
    window.addEventListener('focus', restore);
    return () => { off(); window.removeEventListener('focus', restore); };
  }, [mediaOutbox, chatCache, currentUser.id]);
  const onMessagesRead = useCallback((ids) => {
    const read = new Set(ids);
    if (cacheDriverRef.current) setMessages(chatCache.patch(cacheDriverRef.current, ids, { read_at: new Date().toISOString() }));
    setSearchPage((page) => ({ ...page, messages: page.messages.map((row) => read.has(row.id) ? { ...row, read_at: new Date().toISOString() } : row) }));
    unreadChangeRef.current?.();
  }, [chatCache]);
  const readVisibleMessage = useChatReadReceipts(conversationId, isVisible && !readPaused, onMessagesRead);

  useEffect(() => {
    if (!chatContextMenu) return undefined;
    window.requestAnimationFrame(() => contextMenuButtonRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setChatContextMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [chatContextMenu]);

  useEffect(() => {
    if (!messageContextMenu) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMessageContextMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [messageContextMenu]);


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
    const matching = query ? drivers.filter((driver) => (
      driver.name?.toLowerCase().includes(query)
      || driver.driverNumber?.toLowerCase().includes(query)
      || driver.phone?.toLowerCase().includes(query)
      || driver.truck?.toLowerCase().includes(query)
    )) : [...drivers];
    return matching.sort((left, right) => (Date.parse(driverPreviews[right.id]?.created_at) || 0) - (Date.parse(driverPreviews[left.id]?.created_at) || 0));
  }, [driverSearch, drivers, driverPreviews]);

  useEffect(() => {
    if (!isVisible) return undefined;
    let active = true;
    let refreshing = false;
    let refreshQueued = false;
    const refresh = async () => {
      if (!active) return;
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      do {
        refreshQueued = false;
        try {
          const [conversations, unreadCounts] = await Promise.all([
            fetchChatPreviews(),
            fetchUnreadChatCountsByDriver(currentUser.id),
          ]);
          if (!active) return;
          const next = {};
          const conversationIds = {};
          conversations.forEach((conversation) => {
            const peerId = conversation.driver_id === currentUser.id
              ? conversation.dispatcher_id
              : conversation.driver_id;
            next[peerId] = conversation.chat_messages?.[0] || null;
            conversationIds[peerId] = conversation.id;
          });
          setDriverPreviews(next);
          setDriverConversationIds(conversationIds);
          setDriverUnreadCounts(unreadCounts);
        } catch {
          // Message history still works if the lightweight preview query fails.
        }
      } while (active && refreshQueued);
      refreshing = false;
    };
    void refresh();
    const unsubscribe = subscribeChatPreviews(() => { void refresh(); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUser.id, isVisible]);

  const searching = Boolean(messageSearch.trim()) || mediaFilter !== 'all';
  const historyMessages = mergeChatMessages(messages, [...pendingTexts, ...pendingMedia].filter((row) => row.conversation_id === conversationId));
  const visibleMessages = searching ? searchPage.messages : historyMessages;
  const searchKey = JSON.stringify([conversationId, messageSearch.trim(), mediaFilter, isVisible, searchRevision]);
  useLayoutEffect(() => { searchScope.select(searchKey); }, [searchScope, searchKey]);
  useLayoutEffect(() => { paginationScope.select(searchKey); }, [paginationScope, searchKey]);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- a new query owns a separate pagination request.
    setLoadingOlder(false);
  }, [searchKey]);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- invalidate loading state owned by the previous external search request.
    setSearchLoading(false);
    if (!isVisible || !conversationId || !searching) return;
    let active = true;
    const isCurrent = searchScope.capture();
    const timer = setTimeout(() => {
      setSearchLoading(true);
      searchChatMessages(conversationId, messageSearch, mediaFilter)
        .then((page) => { if (active && isCurrent()) setSearchPage({ ...page, messages: page.messages.filter((row) => !chatCache.isDeleted(cacheDriverRef.current, row.id)) }); })
        .catch((cause) => { if (active && isCurrent()) setError(localizedError(t, cause, 'errors.chatOpen')); })
        .finally(() => { if (active && isCurrent()) setSearchLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [conversationId, messageSearch, mediaFilter, searching, isVisible, t, searchKey, searchScope, chatCache]);

  useEffect(() => {
    if (!conversationId || !isVisible || !showProfile) return;
    let active = true;
    const refresh = () => fetchChatMediaCounts(conversationId).then((counts) => { if (active) setMediaStats(counts); }).catch(() => {});
    void refresh();
    const off = subscribeChatPreviews(refresh);
    return () => { active = false; off(); };
  }, [conversationId, isVisible, showProfile]);

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
    let nextPoll = 0;
    let pollDelay = 1000;
    while (
      peerRef.current
      && activeCallRef.current?.id === callId
      && !peerRef.current.remoteDescription
      && Date.now() < deadline
    ) {
      if (Date.now() >= nextPoll) {
        const signals = await fetchCallSignals(callId);
        if (activeCallRef.current?.id !== callId) throw new DOMException('Call cancelled', 'AbortError');
        for (const signal of signals) await handleSignal(signal);
        nextPoll = Date.now() + pollDelay;
        pollDelay = Math.min(pollDelay * 2, 5000);
      }
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
      const caller = driversRef.current.find((driver) => driver.id === call.initiator_id);
      if (caller) setSelectedDriverId(caller.id);
      incomingCallRef.current = call;
      setIncomingCall(call);
    }
    if (activeCallRef.current?.id === call.id) {
      activeCallRef.current = call;
      setActiveCall(call);
    }
  }, [cleanupCall, currentUser.id]);

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    const refreshCalls = async () => {
      if (refreshing || cancelled) return;
      refreshing = true;
      try {
        const calls = await fetchRingingCalls();
        if (!cancelled) {
          calls.forEach(processCall);
          const ringing = incomingCallRef.current;
          if (ringing && !calls.some((call) => call.id === ringing.id)) {
            incomingCallRef.current = null;
            setIncomingCall(null);
          }
        }
      } catch { /* Realtime remains available; foreground/reconnect retries. */ }
      finally { refreshing = false; }
    };
    const unsubscribe = subscribeCalls({
      onCall: processCall,
      onSignal: (signal) => handleSignal(signal).catch((signalError) => setError(localizedError(translationRef.current, signalError, 'errors.call'))),
      onReconnect: refreshCalls,
    });
    void refreshCalls();
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshCalls(); };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (incomingCallRef.current) void refreshCalls(); }, 15_000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [handleSignal, processCall]);

  useEffect(() => {
    // Keep the selected conversation connected across workspace navigation.
    // Visibility controls read receipts and recording, not cached history.
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
    setUploadProgress(null);
    if (!selectedDriver?.id) return undefined;
    const entry = chatCache.get(selectedDriver.id);
    for (const row of entry.messages) if (row.sender_id === currentUser.id && row.client_id) outbox.acknowledge(row.client_id);
    setPendingTexts(outbox.list());
    cacheDriverRef.current = selectedDriver.id;
    setInputMessage(entry.draft);
    setScrollSnapshot(entry.scroll);
    setHasNewerMessages(Boolean(entry.detached));
    // oxlint-disable-next-line react/set-state-in-effect -- selection starts a new external conversation request.
    setLoading(!entry.conversationId);
    setHistoryError('');
    setError('');
    setMessages(entry.messages);
    setReadPaused(false);
    messagesRef.current = entry.messages;
    setMessageSearch('');
    setMediaFilter('all');
    setSearchPage({ messages: [], hasMore: false });
    setHasOlderMessages(entry.hasMore);
    setConversationId(entry.conversationId);
    setConnectionStatus('connecting');
    let syncEvents = null;
    const recovery = createChatRecovery({
      onState: ({ loading: busy, error: cause }) => {
        if (!isCurrent()) return;
        setLoading(busy && messagesRef.current.length === 0);
        setHistoryError(cause ? localizedError(translationRef.current, cause, 'errors.chatOpen') : '');
      },
      load: async (attemptCurrent) => {
        const current = () => isCurrent() && attemptCurrent();
        if (!current()) return;
        const id = entry.conversationId || await openChat(selectedDriver.id);
        if (!current()) return;
        entry.conversationId = id;
        setConversationId(id);
        if (!subscription) {
          subscription = subscribeChat({
          conversationId: id,
          onStatus: (status) => {
            if (!isCurrent()) return;
            if (status === 'SUBSCRIBED') setConnectionStatus('connected');
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('offline');
            else if (status === 'CLOSED') setConnectionStatus('offline');
          },
          onReconnect: () => recovery.run(),
          onMessage: (message) => {
            if (!isCurrent()) return;
            syncEvents?.push(message);
            applyMessages([message]);
            searchScope.cancel();
            setSearchRevision((value) => value + 1);
          },
          onMessageUpdated: (message) => {
            if (!isCurrent()) return;
            syncEvents?.push(message);
            const previous = messagesRef.current.find((row) => row.id === message.id);
            applyMessages([message]);
            if (message.deleted_at || previous?.body !== message.body) { searchScope.cancel(); setSearchRevision((value) => value + 1); }
            setSearchPage((page) => ({ ...page, messages: mergeChatMessages(page.messages, page.messages.some((row) => row.id === message.id) ? [message] : []) }));
          },
          });
          subscription.ready.then(() => recovery.run()).catch(() => { if (isCurrent()) setConnectionStatus('offline'); });
        }
        // REST history works even when the WebSocket cannot connect.
        const buffered = [];
        syncEvents = buffered;
        try {
          const page = await syncChatHistory(id, buildChatCursor(messagesRef.current), current);
          if (!current()) return;
          applyMessages([...page.messages, ...buffered], { replaceWindow: page.truncated });
          setHasOlderMessages(page.hasMore);
          entry.hasMore = page.hasMore;
        } finally { if (syncEvents === buffered) syncEvents = null; }
      },
    });
    syncRef.current = recovery.run;
    void recovery.run();
    const refresh = () => { if (document.visibilityState === 'visible') void recovery.run(); };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { recovery.dispose(); syncRef.current = null; conversationScope.cancel(); subscription?.unsubscribe(); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [selectedDriver?.id, currentUser.id, conversationScope, chatCache, applyMessages, searchScope, outbox]);

  useEffect(() => {
    if (isVisible) void syncRef.current?.();
  }, [isVisible, selectionRequestKey]);

  // Explicit reopening resumes manual unread mode, including the same selected driver.
  useEffect(() => {
    if (!isVisible || !conversationId) return;
    // oxlint-disable-next-line react/set-state-in-effect -- explicitly reopening synchronizes the server manual-unread preference.
    setReadPaused(false);
    void clearChatUnread(conversationId).catch(() => {});
  }, [isVisible, conversationId, selectionRequestKey]);

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
    setShowProfile(false);
    setMessageContextMenu(null);
    setEditingMessageId(null);
    setSavingEdit(false);
  }, [isVisible]);


  useEffect(() => {
    if (activeChatDriver?.id) {
      // oxlint-disable-next-line react/set-state-in-effect -- synchronize externally requested driver navigation.
      setSelectedDriverId(activeChatDriver.id);
      setShowProfile(false);
      setMessageContextMenu(null);
      setEditingMessageId(null);
      setSavingEdit(false);
    }
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

  const deliverText = useCallback(async (pending) => {
    const request = outbox.send(pending, (row) => sendTextMessage(row.conversation_id, row.body, { clientId: row.client_id, senderId: row.sender_id }));
    setPendingTexts(outbox.list());
    try {
      const message = await request;
      if (message && conversationIdRef.current === pending.conversation_id) applyMessages([message]);
      else if (message) {
        for (const [driverId, entry] of chatCache.entries) {
          if (entry.conversationId === pending.conversation_id) { chatCache.merge(driverId, [message]); break; }
        }
      }
    } catch (cause) {
      if (outbox.rows.has(pending.client_id) && conversationIdRef.current === pending.conversation_id) setError(localizedError(translationRef.current, cause, 'errors.messageSend'));
    } finally { setPendingTexts(outbox.list()); }
  }, [outbox, applyMessages, chatCache]);

  useEffect(() => {
    const off = outbox.subscribe(() => setPendingTexts(outbox.list()));
    const flush = () => {
      if (navigator.onLine === false) return;
      outbox.refresh();
      setPendingTexts(outbox.list());
      for (const row of outbox.list()) if (['queued', 'sending'].includes(row.status) && outbox.canAutoSend(row)) void deliverText(row);
    };
    flush();
    window.addEventListener('online', flush);
    const onStorage = () => { outbox.refresh(); setPendingTexts(outbox.list()); };
    window.addEventListener('storage', onStorage);
    return () => { off(); window.removeEventListener('online', flush); window.removeEventListener('storage', onStorage); };
  }, [outbox, deliverText]);

  const sendMessage = (event) => {
    event?.preventDefault();
    if (!conversationId || !inputMessage.trim()) return;
    try {
      const pending = outbox.enqueue(conversationId, currentUser.id, inputMessage);
      setInputMessage('');
      setPendingTexts(outbox.list());
      setError('');
      if (navigator.onLine !== false) void deliverText(pending);
    } catch (sendError) {
      setError(localizedError(t, sendError, 'errors.messageSend'));
    }
  };

  const deliverMedia = async (pending) => {
    if (uploadAbortRef.current) return;
    const isCurrent = conversationCurrentRef.current;
    const controller = { abort: () => mediaOutbox.cancel(pending.client_id) };
    uploadAbortRef.current = controller;
    setSending(true);
    setUploadProgress(0);
    setError('');
    try {
      const message = await mediaOutbox.send(pending, (row, signal) => sendMediaMessage({
        conversationId: row.conversation_id,
        companyId: row.company_id,
        senderId: row.sender_id,
        clientId: row.client_id,
        file: new File([row.blob], row.file_name, { type: row.mime_type }),
        durationMs: row.duration_ms,
        signal,
        onProgress: (progress) => { if (isCurrent()) setUploadProgress(progress); },
      }));
      if (message && isCurrent()) applyMessages([message]);
      else if (message) for (const [driverId, entry] of chatCache.entries) {
        if (entry.conversationId === pending.conversation_id) { chatCache.merge(driverId, [message]); break; }
      }
    } catch (uploadError) {
      if (isCurrent() && uploadError.name !== 'AbortError') {
        if (mediaOutbox.rows.has(pending.client_id)) setError(localizedError(t, uploadError, 'errors.mediaSend'));
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (isCurrent()) { setUploadProgress(null); setSending(false); }
    }
  };

  const uploadFile = async (file, durationMs = null) => {
    if (!file || !conversationId || uploadAbortRef.current) return;
    const isCurrent = conversationCurrentRef.current;
    try {
      const pending = await mediaOutbox.enqueue({ file, durationMs, conversationId, senderId: currentUser.id, companyId: currentUser.companyId });
      if (isCurrent() && navigator.onLine !== false) await deliverMedia(pending);
    } catch (cause) { if (isCurrent()) setError(localizedError(t, cause, 'errors.mediaSend')); }
  };

  const loadOlderMessages = async () => {
    if (!conversationId || loadingOlder || searchLoading || !(searching ? searchPage.hasMore : hasOlderMessages)) return;
    const request = paginationScope.begin();
    if (!request) return;
    const conversationCurrent = conversationCurrentRef.current;
    const isCurrent = () => conversationCurrent() && request.isCurrent();
    const isSearchCurrent = searchScope.capture();
    setLoadingOlder(true);
    try {
      const page = searching
        ? await searchChatMessages(conversationId, messageSearch, mediaFilter, searchPage.cursor)
        : await fetchChatMessages(conversationId, { before: buildChatCursor(messages) });
      if (!isCurrent() || (searching && !isSearchCurrent())) return;
      if (searching) {
        setSearchPage((previous) => {
          const merged = mergeChatMessages(previous.messages, page.messages.filter((row) => !chatCache.isDeleted(cacheDriverRef.current, row.id)));
          return { ...page, messages: merged.slice(0, 500), detached: previous.detached || merged.length > 500 };
        });
        return;
      }
      applyMessages(page.messages, { older: true });
      setHasOlderMessages(page.hasMore);
      chatCache.get(cacheDriverRef.current).hasMore = page.hasMore;
    } catch (loadError) {
      if (!isCurrent() || (searching && !isSearchCurrent())) return;
      setError(localizedError(t, loadError, 'errors.oldMessages'));
    } finally {
      if (isCurrent() && (!searching || isSearchCurrent())) setLoadingOlder(false);
      request.finish();
    }
  };

  const refreshMedia = useCallback(async (message, force = true) => {
    const isCurrent = conversationCurrentRef.current;
    try {
      const refreshed = await (force ? refreshChatMessageMedia(message) : hydrateChatMessageMedia(message));
      if (!refreshed.mediaUrl) throw new Error(refreshed.mediaError || 'CHAT_MEDIA_UNAVAILABLE');
      if (isCurrent() && !chatCache.isDeleted(cacheDriverRef.current, message.id)) {
        const patch = { mediaUrl: refreshed.mediaUrl, mediaError: null };
        setMessages(chatCache.patch(cacheDriverRef.current, [message.id], patch));
        setSearchPage((page) => ({ ...page, messages: page.messages.map((row) => row.id === message.id ? { ...row, ...patch } : row) }));
        return refreshed;
      }
      throw new Error('CHAT_MEDIA_UNAVAILABLE');
    } catch (refreshError) {
      if (isCurrent()) setError(localizedError(t, refreshError, 'errors.mediaReload'));
      throw refreshError;
    }
  }, [chatCache, t]);

  const removeMessage = async (message) => {
    if (message.sender_id !== currentUser.id) return;
    if (message.status === 'sending') return;
    if (message.status) {
      if (message.kind === 'text') { outbox.acknowledge(message.client_id); setPendingTexts(outbox.list()); }
      else await mediaOutbox.acknowledge(message.client_id).catch((cause) => setError(localizedError(t, cause, 'errors.mediaSend')));
      return;
    }
    if (!window.confirm(t('chat.deleteForEveryoneConfirm'))) return;
    const isCurrent = conversationCurrentRef.current;
    setError('');
    try {
      await deleteChatMessage(message);
      if (isCurrent()) {
        applyMessages([{ ...message, deleted_at: new Date().toISOString() }]);
        setSearchPage((page) => ({ ...page, messages: page.messages.filter((row) => row.id !== message.id) }));
      }
      unreadChangeRef.current?.();
    } catch (deleteError) {
      if (isCurrent()) setError(localizedError(t, deleteError, 'errors.messageDelete'));
    }
  };

  const saveEditedMessage = async (event) => {
    event?.preventDefault();
    const body = editDraft.trim();
    if (!editingMessageId || !body || savingEdit) return;
    const isCurrent = conversationCurrentRef.current;
    setSavingEdit(true);
    setError('');
    try {
      const updated = await editChatMessage(editingMessageId, body);
      if (isCurrent()) {
        applyMessages([updated]);
        setSearchRevision((value) => value + 1);
        setSearchPage((page) => ({ ...page, messages: page.messages.map((row) => row.id === updated.id ? updated : row) }));
        setEditingMessageId(null);
        setEditDraft('');
      }
    } catch (cause) {
      if (isCurrent()) setError(localizedError(t, cause, 'chat.editError'));
    } finally {
      if (isCurrent()) setSavingEdit(false);
    }
  };

  const openMessageContextMenu = (event, message) => {
    if (message.status || message.sender_id !== currentUser.id || message.kind !== 'text') return;
    event.preventDefault();
    setChatContextMenu(null);
    setMessageContextMenu({ message, ...positionChatContextMenu({
      x: event.clientX,
      y: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }) });
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
      setError(localizedError(t, recordError, 'errors.microphone'));
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
        if (callError.name !== 'AbortError') setError(localizedError(t, callError, 'errors.callStart'));
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
        if (callError.name !== 'AbortError') setError(localizedError(t, callError, 'errors.callConnect'));
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
      setError(t('chat.screenUnsupported'));
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
      if (shareError.name !== 'NotAllowedError') setError(localizedError(t, shareError, 'errors.screenShare'));
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await callOverlayRef.current?.requestFullscreen?.();
    } catch (cause) { setError(localizedError(t, cause, 'errors.fullscreen')); }
  };

  const openChatContextMenu = (event, driverId) => {
    event.preventDefault();
    const position = positionChatContextMenu({
      x: event.clientX,
      y: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setChatContextMenu({ driverId, ...position });
  };

  const markDriverChatUnread = async () => {
    const driverId = chatContextMenu?.driverId;
    if (!driverId || markingUnreadDriverId) return;
    setMarkingUnreadDriverId(driverId);
    try {
      const targetConversationId = (
        driverId === selectedDriver?.id ? conversationId : null
      ) || driverConversationIds[driverId] || await openChat(driverId);
      if (driverId === selectedDriver?.id) setReadPaused(true);
      const messageId = await markChatUnread(targetConversationId);
      if (!messageId && driverId === selectedDriver?.id) setReadPaused(false);
      if (messageId) {
        setDriverUnreadCounts((current) => ({
          ...current,
          [driverId]: Math.max(1, current[driverId] || 0),
        }));
        unreadChangeRef.current?.();
      }
    } catch {
      setReadPaused(false);
      setError(t('chat.markUnreadError'));
    } finally {
      setMarkingUnreadDriverId(null);
      setChatContextMenu(null);
    }
  };

  if (!selectedDriver) {
    return <div className="dispatch-chat-workspace h-full grid place-items-center text-zinc-500">{t('chat.noDriver')}</div>;
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
              placeholder={t('chat.searchChats')}
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-white"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredDrivers.length > 0 && <Virtuoso style={{ height: '100%' }} data={filteredDrivers} computeItemKey={(_, driver) => driver.id} itemContent={(_, driver) => {
            const selected = driver.id === selectedDriver.id;
            const unreadCount = driverUnreadCounts[driver.id] || 0;
            return (
              <button
                key={driver.id}
                type="button"
                onContextMenu={(event) => openChatContextMenu(event, driver.id)}
                onClick={() => {
                  setChatContextMenu(null);
                  setMessageContextMenu(null);
                  setEditingMessageId(null);
                  setSavingEdit(false);
                  setSelectedDriverId(driver.id);
                  setReadPaused(false);
                  if (driver.id === selectedDriver.id && conversationId) void clearChatUnread(conversationId).catch(() => {});
                  setShowProfile(false);
                  setMessageSearch('');
                  setMediaFilter('all');
                }}
                className={`w-full p-4 flex gap-3 text-left border-b border-zinc-200/70 dark:border-zinc-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/25' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
              >
                <DriverAvatar driver={driver} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${unreadCount ? 'font-black' : 'font-bold'}`}>{driver.name}</p>
                  <p className={`mt-1 truncate text-xs ${unreadCount ? 'font-bold text-zinc-800 dark:text-zinc-200' : 'text-zinc-400'}`}>{messagePreview(
                    selected ? messages[messages.length - 1] || driverPreviews[driver.id] : driverPreviews[driver.id],
                    t,
                  )}</p>
                </div>
                {unreadCount > 0 && (
                  <span className="grid min-h-5 min-w-5 place-items-center self-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          }} />}
          {filteredDrivers.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">{t('chat.noChats')}</div>
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
                placeholder={t('chat.search')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <button type="button" onClick={() => { setShowMessageSearch(false); setMessageSearch(''); }} title={t('header.closeSearch')} className="rounded-full p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3 text-left">
              <DriverAvatar driver={selectedDriver} sizeClass="w-10 h-10" />
              <span className="min-w-0">
                <span className="block truncate font-black">{selectedDriver.name}</span>
                <span className={`block text-xs font-semibold ${connectionStatus === 'connected' ? (selectedDriver.isOnline ? 'text-emerald-500' : 'text-zinc-400') : 'text-amber-600'}`}>
                  {connectionStatus === 'connected' ? (selectedDriver.isOnline ? t('common.online') : selectedDriver.lastSeenAt ? t('chat.lastSeenAt', { date: formatDateTime(selectedDriver.lastSeenAt) }) : t('common.offline')) : connectionStatus === 'connecting' ? t('chat.connecting') : t('chat.reconnecting')}
                </span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-1">
            {!showMessageSearch && <button type="button" onClick={() => setShowMessageSearch(true)} title={t('chat.search')} className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"><Search className="w-5 h-5" /></button>}
            <button onClick={() => placeCall('audio')} title={t('chat.audioCall')} className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-blue-600"><Phone className="w-5 h-5" /></button>
            <button onClick={() => placeCall('video')} title={t('chat.videoCall')} className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-blue-600"><Video className="w-5 h-5" /></button>
            <button type="button" aria-pressed={showProfile} onClick={() => setShowProfile((current) => !current)} title={t('chat.driverInfo')} className={`p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${showProfile ? 'text-blue-600' : 'text-zinc-500'}`}><PanelRight className="w-5 h-5" /></button>
            {compact && <button onClick={onClose} title={t('chat.close')} className="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"><X className="w-5 h-5" /></button>}
          </div>
        </header>

        {mediaFilter !== 'all' && (
          <div className="flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950/80">
            <span className="font-bold text-zinc-700 dark:text-zinc-200">{({ image: t('chat.images'), video: t('chat.videos'), file: t('chat.files'), audio: t('common.audio'), links: t('chat.links') })[mediaFilter]}</span>
            <button type="button" onClick={() => setMediaFilter('all')} className="font-bold text-blue-600">{t('chat.showAll')}</button>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">
            <span>{error}</span>
          </div>
        )}

        {historyError && (
          <div role="alert" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <span>{historyError}</span>
            <button type="button" onClick={() => { void syncRef.current?.(); }} className="shrink-0 font-bold underline">{t('common.retry')}</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col py-3">
          {loading && <div className="h-full grid place-items-center"><LoaderCircle className="animate-spin text-blue-600" /></div>}
          {!loading && (searching ? searchPage.hasMore : hasOlderMessages) && (
            <div className="flex justify-center pb-2">
              <button type="button" disabled={loadingOlder} onClick={loadOlderMessages} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {loadingOlder ? t('common.loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {!loading && !historyError && historyMessages.length === 0 && (
            <div className="h-full grid place-items-center text-center text-zinc-500">
              <div><div className="text-5xl mb-3">👋</div><p className="font-black text-zinc-800 dark:text-zinc-100">{t('chat.start')}</p><p className="text-sm">{t('chat.startHint')}</p></div>
            </div>
          )}
          {!loading && historyMessages.length > 0 && visibleMessages.length === 0 && (
            <div className="h-full grid place-items-center text-center text-zinc-500">
              <div><Search className="mx-auto mb-3 h-8 w-8" /><p className="font-bold">{t('chat.noMatches')}</p></div>
            </div>
          )}
          {searchLoading && <div className="text-center text-xs text-zinc-500">{t('common.loading')}</div>}
          {!loading && visibleMessages.length > 0 && <ChatTimeline key={`${conversationId}:${searching ? `${messageSearch}:${mediaFilter}` : 'history'}`} isVisible={isVisible} messages={visibleMessages} hasOlderMessages={searching ? searchPage.hasMore : hasOlderMessages} loadingOlder={loadingOlder || searchLoading} onLoadOlder={loadOlderMessages} hasNewerMessages={searching ? searchPage.detached : hasNewerMessages} restoreState={searching ? null : scrollSnapshot} onSaveState={searching ? undefined : saveScroll} onLatest={async () => {
            paginationScope.invalidate();
            setLoadingOlder(false);
            const request = paginationScope.begin();
            const conversationCurrent = conversationCurrentRef.current;
            const isCurrent = () => conversationCurrent() && request.isCurrent();
            try {
              if (searching) {
                const isSearchCurrent = searchScope.capture();
                const page = await searchChatMessages(conversationId, messageSearch, mediaFilter);
                if (isCurrent() && isSearchCurrent()) setSearchPage({ ...page, messages: page.messages.filter((row) => !chatCache.isDeleted(cacheDriverRef.current, row.id)) });
                return;
              }
              const page = await fetchChatMessages(conversationId, { pageSize: 100 });
              if (!isCurrent()) return;
              applyMessages(page.messages, { replaceWindow: true });
              setHasOlderMessages(page.hasMore);
              chatCache.get(cacheDriverRef.current).hasMore = page.hasMore;
            } finally { request.finish(); }
          }}>{(message, index) => {
            const mine = message.sender_id === currentUser.id;
            const showDate = index === 0 || messageDayKey(message.created_at) !== messageDayKey(visibleMessages[index - 1].created_at);
            return (
              <ChatReadBoundary message={message} enabled={isVisible && !readPaused && !mine} onRead={readVisibleMessage}>
                {showDate && (
                  <div className="sticky top-1 z-10 flex justify-center py-2">
                    <span className="rounded-full bg-zinc-800/75 px-3 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur dark:bg-zinc-700/85">{messageDayLabel(message.created_at, t)}</span>
                  </div>
                )}
                <div className={`group flex items-center gap-1 ${mine ? 'justify-end' : 'justify-start'}`} onContextMenu={(event) => openMessageContextMenu(event, message)}>
                  {mine && message.status !== 'sending' && <button type="button" onClick={() => removeMessage(message)} title={t('chat.deleteMessage')} className="p-1.5 rounded-full text-zinc-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"><Trash2 className="w-4 h-4" /></button>}
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 shadow-sm ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-bl-md'}`}>
                    {editingMessageId === message.id ? <form onSubmit={saveEditedMessage} className="min-w-48 space-y-2">
                      <textarea autoFocus value={editDraft} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setEditingMessageId(null); setEditDraft(''); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveEditedMessage(); } }} rows={2} maxLength={4000} aria-label={t('chat.editMessage')} className="w-full resize-y rounded-lg bg-white px-2 py-1 text-sm text-zinc-900 outline-none" />
                      <div className="flex justify-end gap-2 text-xs font-bold"><button type="button" onClick={() => { setEditingMessageId(null); setEditDraft(''); }} disabled={savingEdit}>{t('common.cancel')}</button><button type="submit" disabled={savingEdit || !editDraft.trim()}>{savingEdit ? t('common.loading') : t('common.save')}</button></div>
                    </form> : message.kind === 'text' ? <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p> : message.status ? <p className="flex items-center gap-2 break-all text-sm"><FileText className="h-5 w-5 shrink-0" />{message.file_name}</p> : <MediaMessage message={message} onRefresh={refreshMedia} />}
                    <div className={`mt-1 text-[10px] flex items-center justify-end gap-1 ${mine ? 'text-blue-100' : 'text-zinc-400'}`}>
                      {message.edited_at && <span>{t('chat.edited')}</span>}
                      <span>{messageTime(message.created_at)}</span>
                      {mine && (message.status ? <span className="inline-flex items-center gap-1">
                        {message.status === 'failed' || (message.kind !== 'text' && message.status === 'queued') ? <button type="button" disabled={message.kind !== 'text' && sending} onClick={() => message.kind === 'text' ? deliverText(message) : deliverMedia(message)} className="font-bold underline disabled:opacity-50">{t(message.status === 'failed' ? 'chat.sendFailed' : 'chat.queued')} · {t('chat.resend')}</button> : <><Clock3 className="h-3.5 w-3.5" />{t(message.status === 'sending' ? 'chat.sending' : 'chat.queued')}</>}
                      </span> : message.read_at ? <CheckCheck aria-label={t('chat.read')} className="w-3.5 h-3.5 text-cyan-200" /> : <Check aria-label={t('chat.sent')} className="w-3.5 h-3.5" />)}
                    </div>
                  </div>
                </div>
              </ChatReadBoundary>
            );
          }}</ChatTimeline>}
        </div>

        {uploadProgress !== null && (
          <div className="border-t border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950" aria-live="polite">
            <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-zinc-500"><span>{t('chat.mediaUploading')}</span><button type="button" onClick={() => uploadAbortRef.current?.abort()} className="text-red-600">{t('common.cancel')}</button></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(uploadProgress * 100)}%` }} /></div>
          </div>
        )}
        <form onSubmit={sendMessage} className="relative shrink-0 px-3 py-3 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-end gap-2">
          <input ref={fileInputRef} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf" onChange={(event) => { uploadFile(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title={t('chat.sendMedia')} className="p-2.5 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Paperclip className="w-5 h-5" /></button>
          <div className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3">
            <textarea ref={composerRef} rows="1" maxLength={4000} value={inputMessage} onChange={(event) => setInputMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={t('chat.typeMessage')} className="w-full max-h-28 resize-none bg-transparent py-2.5 text-sm outline-none" />
          </div>
          <button type="button" onClick={() => setShowEmojiPicker((current) => !current)} title={t('chat.emoji')} className="p-2.5 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Smile className="w-5 h-5" /></button>
          {inputMessage.trim() ? (
            <button type="submit" className="p-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-500"><Send className="w-5 h-5" /></button>
          ) : (
            <button type="button" onClick={toggleRecording} title={t('common.audio')} className={`p-2.5 rounded-full text-white ${recording ? 'bg-red-600 animate-pulse' : 'bg-blue-600'}`}>{recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
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
        <button type="button" aria-label={t('chat.closeDriverInfo')} onClick={() => setShowProfile(false)} className="absolute inset-0 z-20 bg-zinc-950/25 backdrop-blur-[1px] lg:hidden" />
        <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(300px,calc(100%-1rem))] min-w-0 flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 lg:static lg:w-auto lg:shadow-none">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
            <p className="font-black">{t('chat.driverInfo')}</p>
            <button type="button" onClick={() => setShowProfile(false)} title={t('common.close')} className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="border-b border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
              <div className="mx-auto w-fit"><DriverAvatar driver={selectedDriver} sizeClass="w-20 h-20" /></div>
              <h3 className="mt-3 truncate text-lg font-black">{selectedDriver.name}</h3>
              <p className={`mt-1 text-xs font-semibold ${selectedDriver.isOnline ? 'text-emerald-500' : 'text-zinc-400'}`}>{selectedDriver.isOnline ? t('common.online') : t('common.offline')}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => placeCall('audio')} className="rounded-xl bg-zinc-100 px-2 py-3 text-xs font-bold hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"><Phone className="mx-auto mb-1 h-5 w-5 text-blue-600" />{t('common.audio')}</button>
                <button type="button" onClick={() => placeCall('video')} className="rounded-xl bg-zinc-100 px-2 py-3 text-xs font-bold hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"><Video className="mx-auto mb-1 h-5 w-5 text-blue-600" />{t('common.video')}</button>
              </div>
            </div>

            <div className="space-y-4 border-b border-zinc-200 px-4 py-5 text-sm dark:border-zinc-800">
              <div className="flex items-start gap-3"><Phone className="mt-0.5 h-4 w-4 text-zinc-400" /><div className="min-w-0"><p className="break-all font-semibold">{selectedDriver.phone || t('common.notProvided')}</p><p className="text-xs text-zinc-500">{t('common.phone')}</p></div></div>
              <div className="flex items-start gap-3"><UserRound className="mt-0.5 h-4 w-4 text-zinc-400" /><div><p className="font-semibold">{selectedDriver.driverNumber}</p><p className="text-xs text-zinc-500">{t('chat.driverId')}</p></div></div>
            </div>

            <div className="py-2">
              {[
                ['image', t('chat.images'), ImageIcon, mediaStats.image],
                ['video', t('chat.videos'), Video, mediaStats.video],
                ['file', t('chat.files'), FileText, mediaStats.file],
                ['audio', t('common.audio'), Music2, mediaStats.audio],
                ['links', t('chat.links'), Link2, mediaStats.links],
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

      {chatContextMenu && createPortal(
        <div
          className="fixed inset-0 z-[90]"
          onPointerDown={() => setChatContextMenu(null)}
          onContextMenu={(event) => { event.preventDefault(); setChatContextMenu(null); }}
        >
          <div
            role="menu"
            aria-label={t('chat.chatActions')}
            className="fixed w-[230px] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: chatContextMenu.left, top: chatContextMenu.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              ref={contextMenuButtonRef}
              type="button"
              role="menuitem"
              disabled={Boolean(markingUnreadDriverId)}
              onClick={markDriverChatUnread}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {markingUnreadDriverId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              <span>{t('chat.markUnread')}</span>
            </button>
          </div>
        </div>,
        document.body,
      )}

      {messageContextMenu && createPortal(
        <div className="fixed inset-0 z-[90]" onPointerDown={() => setMessageContextMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMessageContextMenu(null); }}>
          <div role="menu" aria-label={t('chat.messageActions')} className="fixed w-[190px] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900" style={{ left: messageContextMenu.left, top: messageContextMenu.top }} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" autoFocus onClick={() => { setEditingMessageId(messageContextMenu.message.id); setEditDraft(messageContextMenu.message.body || ''); setMessageContextMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"><Pencil className="h-4 w-4" />{t('chat.editMessage')}</button>
          </div>
        </div>,
        document.body,
      )}

      {incomingCall && createPortal(
        <CallDialog label={t('chat.incomingCall')}><div className="fixed inset-0 z-[100] bg-zinc-950/80 backdrop-blur flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center text-white">
            <div className="w-24 h-24 mx-auto rounded-full bg-blue-600 grid place-items-center text-4xl font-black shadow-2xl">{callDriver?.name?.charAt(0) || '?'}</div>
            <h3 className="mt-5 text-2xl font-black">{callDriver?.name || t('roles.driver')}</h3>
            <p className="text-zinc-300 mt-1">{incomingCall.kind === 'video' ? t('chat.incomingVideo') : t('chat.incomingAudio')}</p>
            <div className="mt-8 flex justify-center gap-8">
              <button onClick={declineIncomingCall} aria-label={t('chat.decline')} className="w-16 h-16 rounded-full bg-red-600 grid place-items-center"><PhoneOff /></button>
              <button onClick={acceptIncomingCall} aria-label={t('chat.accept')} className="w-16 h-16 rounded-full bg-emerald-500 grid place-items-center"><Phone /></button>
            </div>
          </div>
        </div></CallDialog>, document.body
      )}

      {activeCall && createPortal(
        <CallDialog label={t('chat.activeCall')}><div ref={callOverlayRef} className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#191d22] text-white">
          {activeCall.kind === 'audio' && <audio ref={attachRemoteVideo} autoPlay />}
          {playbackBlocked && <button type="button" onClick={() => remoteVideoRef.current?.play().then(() => setPlaybackBlocked(false)).catch(() => {})} className="absolute left-4 top-4 z-30 rounded-lg bg-blue-600 px-4 py-2">{t('chat.enableSound')}</button>}
          <header className="relative z-20 flex min-h-[118px] shrink-0 items-center justify-center px-5 pt-5 text-center sm:min-h-[136px]">
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xl font-black shadow-lg ring-2 ring-white/10">
                {callDriver?.avatar ? <img src={callDriver.avatar} alt="" className="h-full w-full object-cover" /> : callDriver?.name?.charAt(0) || '?'}
              </div>
              <h2 className="mt-2 text-lg font-bold leading-tight">{callDriver?.name || t('roles.driver')}</h2>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                {callConnectionState === 'connected'
                  ? `${callDuration(callSeconds)} · ${t('chat.encrypted')}`
                  : callConnectionState === 'reconnecting'
                    ? t('chat.reconnecting')
                    : callConnectionState === 'failed'
                      ? t('chat.connectionLost')
                      : t('chat.establishingSecure')}
              </p>
            </div>
            <button type="button" onClick={toggleFullscreen} title={t('chat.fullscreen')} className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white">
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
                  <h3 className="mt-5 text-2xl font-bold">{callDriver?.name || t('roles.driver')}</h3>
                  <p className="mt-2 text-sm text-zinc-400">{callConnectionState === 'connected' ? (activeCall.kind === 'video' ? t('chat.waitingVideo') : t('chat.audioCall')) : t('chat.connecting')}</p>
                </div>
              )}

              {screenSharing && (
                <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-blue-600/90 px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur">
                  <MonitorUp className="h-4 w-4" /> {t('chat.screenSharing')}
                </div>
              )}

              {activeCall.kind === 'video' && (
                <div className="absolute right-3 top-3 z-20 aspect-[3/4] w-24 overflow-hidden rounded-xl border border-white/20 bg-zinc-900 shadow-2xl sm:right-4 sm:top-4 sm:w-36">
                  <video ref={attachLocalVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${cameraEnabled ? '' : 'invisible'}`} />
                  {!cameraEnabled && <div className="absolute inset-0 grid place-items-center"><VideoOff className="h-6 w-6 text-zinc-400" /></div>}
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold">{t('chat.you')}</span>
                </div>
              )}
            </div>
          </main>

          <footer className="relative z-20 flex min-h-[118px] shrink-0 items-center justify-center px-4 pb-4 pt-5 sm:min-h-[136px]">
            <div className="flex items-start justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 shadow-xl backdrop-blur sm:gap-5 sm:px-6">
              {activeCall.kind === 'video' && <CallControl icon={MonitorUp} label={screenSharing ? t('chat.stopSharing') : t('chat.screen')} active={screenSharing} disabled={!localStream} onClick={toggleScreenShare} />}
              {activeCall.kind === 'video' && <CallControl icon={cameraEnabled ? Video : VideoOff} label={cameraEnabled ? t('chat.cameraOff') : t('chat.cameraOn')} active={!cameraEnabled} disabled={screenSharing || !localStream} onClick={toggleCamera} />}
              <CallControl icon={PhoneOff} label={t('chat.endCall')} danger onClick={endCall} />
              <CallControl icon={microphoneEnabled ? Mic : MicOff} label={microphoneEnabled ? t('chat.micOff') : t('chat.micOn')} active={!microphoneEnabled} disabled={!localStream} onClick={toggleMicrophone} />
              <CallControl icon={Maximize2} label={t('chat.fullscreen')} onClick={toggleFullscreen} />
            </div>
          </footer>
          <p className="pointer-events-none absolute bottom-2 left-4 hidden text-[10px] text-zinc-600 lg:block">{t('chat.drivexCall')}</p>
        </div></CallDialog>, document.body
      )}
    </Fragment>
  );
}
