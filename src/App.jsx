import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import LazyRouteBoundary from './components/LazyRouteBoundary';
import { useAuth } from './hooks/useAuth';
import { useTimeZonePreference } from './hooks/useTimeZonePreference.js';
import { WorkspaceCache, useWorkspaceInvalidation } from './hooks/WorkspaceCache';
import {
  createManualLoad,
  approveLoadDraft,
  prepareLoadFromDocument,
  prepareLoadFromBrokerAttachment,
  sendPreviewDocumentLoad,
  assignLoadDirectly,
  reviewAndAssignDocumentLoad,
  fetchWorkspace,
  fetchWorkspaceAvatar,
  fetchDriverPresence,
  createMember,
  deleteCompanyMember,
  fetchBrokerInboxUnreadCount,
  subscribeWorkspace,
  updateMyLocale,
} from './services/operationsService';
import {
  fetchRingingCalls,
  fetchUnreadChatCountsByDriver,
  subscribeCalls,
  subscribeUnreadChats,
} from './services/chatService';
import { chatAccountKey, clearPersistedChatSession } from './services/chatSession';
import { clearPersistedChatMedia } from './services/chatMediaOutbox';
import { buildGlobalSearchResults } from './utils/globalSearch';
import { localizedError } from './i18n/errors';
import { runLoadTrashAction, loadTrashMetadata, partitionTrashedLoads } from './services/loadTrashActions.js';
import { isRecoverableLoad, recoverSavedLoad } from './services/savedLoadRecovery.js';
import { loadBoardStatus } from './services/loadBoardStatus.js';
import { loadImportFileError } from './services/loadImportFile';
import { createDocumentImportRunner, mergeDocumentImportResult, continueDocumentImport, shouldCancelImportOnNavigation, findExistingFinalizedLoad } from './services/documentImportSession';
import { setAppLocale } from './i18n';
import { changeLocaleWithProfileSync } from './i18n/localeSync';
import { supabase } from './lib/supabase';
import { useWebPush } from './hooks/useWebPush';
import { syncAnalyticsPrivacy, trackPage } from './services/firebaseAnalytics';
import { createCoalescedAsyncTrigger } from './services/realtimeRefresh';
import { createSerializedRefresh } from './services/serializedRefresh';
import { preserveWorkspaceAvatars, applyWorkspaceAvatar, hydrateWorkspaceAvatars } from './services/workspaceAvatars.js';
import { refreshDriverPresence, presenceTimestamp, mergePresenceSnapshot } from './services/driverPresence.js';
import {
  clearPendingLocaleOverride,
  persistPendingLocaleOverride,
  resolveLocaleForProfile,
} from './i18n/locales';

const tabs = ['kanban', 'drivers', 'map', 'analytics', 'docs', 'inbox', 'chat', 'profile'];
const routeLoaders = {
  analytics: () => import('./components/AnalyticsOverview'),
  chat: () => import('./components/DispatchChat'),
  kanban: () => import('./components/LoadsWorkspace'),
  map: () => import('./components/FleetMap'),
  drivers: () => import('./components/DriversPage'),
  profile: () => import('./components/ProfileView'),
  docs: () => import('./components/DocumentsView'),
  inbox: () => import('./components/BrokerInbox'),
};
function prefetchRoute(tab) {
  if (tab === 'map') return Promise.all([routeLoaders.map(), import('./components/TrackingMap')]);
  return routeLoaders[tab]?.();
}
const AnalyticsOverview = React.lazy(routeLoaders.analytics);
const DispatchChat = React.lazy(routeLoaders.chat);
const AuthView = React.lazy(() => import('./components/AuthView'));
const LoadsWorkspace = React.lazy(routeLoaders.kanban);
const FleetMap = React.lazy(routeLoaders.map);
const DriverRoster = React.lazy(routeLoaders.drivers);
const CreateLoadModal = React.lazy(() => import('./components/CreateLoadModal'));
const QuickDriverModal = React.lazy(() => import('./components/QuickDriverModal'));
const ImportDriverPicker = React.lazy(() => import('./components/ImportDriverPicker'));
const ImportedLoadPage = React.lazy(() => import('./components/ImportedLoadPage'));
const DocumentViewerModal = React.lazy(() => import('./components/DocumentViewerModal'));
const ProfileView = React.lazy(routeLoaders.profile);
const DocumentsView = React.lazy(routeLoaders.docs);
const BrokerInbox = React.lazy(routeLoaders.inbox);
const PlatformAdminPanel = React.lazy(() => import('./components/PlatformAdminPanel'));

export default function App() {
  const auth = useAuth();
  useEffect(() => {
    const syncPrivacy = () => { void syncAnalyticsPrivacy(); };
    window.addEventListener('storage', syncPrivacy);
    return () => window.removeEventListener('storage', syncPrivacy);
  }, []);
  const browserPush = useWebPush(auth.currentUser?.companyId ? auth.currentUser.id : null, auth.loading);
  const scope = JSON.stringify([auth.currentUser?.id, auth.currentUser?.companyId, auth.currentUser?.roleCode]);
  return <WorkspaceCache key={scope}><Workspace auth={auth} browserPush={browserPush} /></WorkspaceCache>;
}

function Workspace({ auth, browserPush }) {
  const { t, i18n } = useTranslation();
  const disableBrowserPush = browserPush.disable;
  const invalidate = useWorkspaceInvalidation();
  const querySourcesRef = useRef('');
  const { currentUser, loading: authLoading, configured, authError, login, logout: authLogout } = auth;
  const [displayTimeZone, setDisplayTimeZone] = useTimeZonePreference(currentUser?.id);
  const logout = useCallback(async () => {
    await disableBrowserPush().catch(() => {});
    clearPersistedChatSession(chatAccountKey(currentUser));
    await clearPersistedChatMedia(chatAccountKey(currentUser)).catch(() => {});
    return authLogout();
  }, [currentUser, authLogout, disableBrowserPush]);
  const [activeTab, setActiveTab] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return tabs.includes(hash) ? hash : 'kanban';
  });
  useEffect(() => {
    if (!authLoading) void trackPage(currentUser?.id ? activeTab : 'login');
  }, [activeTab, authLoading, currentUser?.id]);
  const [loads, setLoads] = useState([]);
  const [trashedLoads, setTrashedLoads] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [members, setMembers] = useState([]);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [operationLoading, setOperationLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDriverForLoad, setSelectedDriverForLoad] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [driverProfileRequest, setDriverProfileRequest] = useState(0);
  const [draftRecoveryRequest, setDraftRecoveryRequest] = useState(0);
  const [profileEditDriverId, setProfileEditDriverId] = useState(null);
  const [chatDriverId, setChatDriverId] = useState(null);
  const [chatSelectionRequest, setChatSelectionRequest] = useState(0);
  const [chatWasOpened, setChatWasOpened] = useState(() => window.location.hash === '#chat');
  const [mapWasOpened, setMapWasOpened] = useState(() => window.location.hash === '#map');
  const [inlineChatDriverId, setInlineChatDriverId] = useState(null);
  const [aiPreparedLoad, setAiPreparedLoad] = useState(null);
  const importFileRef = useRef(null);
  const importTabRef = useRef(null);
  const importRunnerRef = useRef(null);
  if (!importRunnerRef.current) importRunnerRef.current = createDocumentImportRunner();
  const importDriverPickerVisible = aiPreparedLoad?.source === 'document' && aiPreparedLoad.awaitingDriverSelection;
  const importPageVisible = aiPreparedLoad?.source === 'document' && !importDriverPickerVisible;
  const importSourceUrl = aiPreparedLoad?.sourceUrl;
  useEffect(() => () => {
    if (importSourceUrl?.startsWith('blob:')) URL.revokeObjectURL(importSourceUrl);
  }, [importSourceUrl]);
  const [aiProcessing, setAiProcessing] = useState(false);
  const cancelDocumentImport = useCallback(() => {
    importRunnerRef.current.cancel();
    importFileRef.current = null;
    importTabRef.current = null;
    setAiPreparedLoad(null);
    setAiProcessing(false);
  }, []);
  useEffect(() => () => importRunnerRef.current.cancel(), []);
  const [selectedLoadForDocs, setSelectedLoadForDocs] = useState(null);
  const [selectedDocumentTab, setSelectedDocumentTab] = useState('rateCon');
  const [toast, setToast] = useState({ show: false, message: '' });
  const [theme, setTheme] = useState(() => localStorage.getItem('apex_theme') || 'light');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadChatsByDriver, setUnreadChatsByDriver] = useState({});
  const [unreadInboxCount, setUnreadInboxCount] = useState(0);
  const inboxRefreshRef = useRef(null);
  const workspaceActiveRef = useRef(true);
  const workspaceGenerationRef = useRef(0);
  const presenceUpdatesRef = useRef(new Map());
  const foregroundRefreshCountRef = useRef(0);
  const inlineChatVisible = activeTab === 'drivers' && Boolean(inlineChatDriverId);
  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selectedDriverId) || null,
    [drivers, selectedDriverId],
  );
  const currentUserId = currentUser?.id;
  const currentUserRoleCode = currentUser?.roleCode;
  const currentUserLocale = currentUser?.locale;

  useEffect(() => {
    if (currentUserId) {
      void setAppLocale(resolveLocaleForProfile(currentUserLocale, currentUserId));
    }
  }, [currentUserId, currentUserLocale]);

  useEffect(() => {
    if (!currentUserId || !workspaceReady || ['driver', 'super_admin'].includes(currentUserRoleCode) || navigator.connection?.saveData) return undefined;
    // Keep large map tiles on demand; preload lighter, commonly visited screens only.
    const pending = ['drivers', 'analytics', 'profile', 'inbox', 'kanban', 'chat']
      .filter((tab) => tab !== activeTab);
    let cancelled = false;
    let scheduledId;
    let scheduledWithIdleCallback = false;
    const scheduleNext = () => {
      if (cancelled || !pending.length) return;
      const loadNext = () => {
        const tab = pending.shift();
        void prefetchRoute(tab).catch(() => {}).finally(scheduleNext);
      };
      if (window.requestIdleCallback) {
        scheduledWithIdleCallback = true;
        scheduledId = window.requestIdleCallback(loadNext, { timeout: 3000 });
      } else {
        scheduledWithIdleCallback = false;
        scheduledId = window.setTimeout(loadNext, 500);
      }
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (scheduledWithIdleCallback) window.cancelIdleCallback?.(scheduledId);
      else window.clearTimeout(scheduledId);
    };
    // Prefetch once per signed-in user; changing tabs must not restart the queue.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, currentUserRoleCode, workspaceReady]);

  const showToast = useCallback((message) => {
    setToast({ show: true, message });
    window.setTimeout(() => setToast((previous) => ({ ...previous, show: false })), 4500);
  }, []);

  const handleOpenDocs = useCallback((load, documentTab = 'rateCon') => {
    setSelectedDocumentTab(documentTab);
    setSelectedLoadForDocs(load);
  }, []);

  const handleLocaleChange = useCallback(async (locale) => {
    await changeLocaleWithProfileSync(locale, {
      applyLocale: setAppLocale,
      syncLocale: updateMyLocale,
      markPending: (selectedLocale) => persistPendingLocaleOverride(selectedLocale, currentUserId),
      clearPending: (selectedLocale) => clearPendingLocaleOverride(selectedLocale, currentUserId),
      // `t` is bound to the locale from the current React render. Use the
      // selected locale explicitly so feedback shown during the same async
      // change is never left in the previous language.
      onSynced: (selectedLocale) => showToast(i18n.t('profile.languageSaved', { lng: selectedLocale })),
      onSyncFailed: (_error, selectedLocale) => showToast(i18n.t('profile.languageLocalOnly', { lng: selectedLocale })),
    });
  }, [currentUserId, i18n, showToast]);

  const readWorkspaceRef = useRef(null);
  readWorkspaceRef.current = async () => {
    if (!workspaceActiveRef.current) return;
    const generation = ++workspaceGenerationRef.current;
    const isCurrent = () => workspaceActiveRef.current && generation === workspaceGenerationRef.current;
    try {
      const workspace = await fetchWorkspace();
      if (!isCurrent()) return;
      const querySources = JSON.stringify([
        workspace.loads.map(load => [load.id, load.status, load.rate, load.distanceMiles, load.driverId, load.trashedAt, load.version]),
        workspace.drivers.map(driver => [driver.id, driver.truck, driver.trailer]),
      ]);
      if (querySourcesRef.current && querySourcesRef.current !== querySources) {
        void invalidate(key => key === 'fleet-vehicles'
          || (Array.isArray(key) && ['trip-analytics', 'driver-sessions'].includes(key[0]))).catch(() => {});
      }
      querySourcesRef.current = querySources;
      const partition = partitionTrashedLoads(workspace.loads);
      setLoads(partition.active);
      setTrashedLoads(partition.trash);
      setDrivers(previous => preserveWorkspaceAvatars(
        refreshDriverPresence(workspace.drivers, presenceUpdatesRef.current), previous,
      ));
      setMembers(previous => preserveWorkspaceAvatars(workspace.members, previous));
      setWorkspaceReady(true);
      setWorkspaceError('');
      void hydrateWorkspaceAvatars(workspace.members, fetchWorkspaceAvatar, (member, avatar) => {
        setDrivers(previous => applyWorkspaceAvatar(previous, member, avatar));
        setMembers(previous => applyWorkspaceAvatar(previous, member, avatar));
      }, isCurrent);
    } catch (error) {
      if (isCurrent()) setWorkspaceError(localizedError(t, error, 'errors.workspace'));
    }
  };
  const serializedWorkspaceRefresh = useMemo(() => createSerializedRefresh(() => readWorkspaceRef.current()), []);
  const refreshWorkspace = useCallback(async ({ quiet = false } = {}) => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return;
    if (!quiet) {
      foregroundRefreshCountRef.current += 1;
      setRefreshLoading(true);
    }
    try {
      await serializedWorkspaceRefresh();
    } finally {
      if (!quiet) {
        foregroundRefreshCountRef.current = Math.max(
          foregroundRefreshCountRef.current - 1,
          0,
        );
        if (foregroundRefreshCountRef.current === 0) {
          setRefreshLoading(false);
        }
      }
    }
  }, [currentUserId, currentUserRoleCode, serializedWorkspaceRefresh]);

  const refreshUnreadChats = useCallback(async () => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return;
    try {
      const counts = await fetchUnreadChatCountsByDriver();
      setUnreadChatCount(Object.values(counts).reduce((sum, count) => sum + count, 0));
      setUnreadChatsByDriver(counts);
    } catch { /* Preserve the last known counts while reconnecting. */ }
  }, [currentUserId, currentUserRoleCode]);

  const refreshUnreadInbox = useCallback(() => inboxRefreshRef.current?.(), []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('apex_theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      const nextTab = currentUser?.roleCode === 'super_admin' ? 'profile' : tabs.includes(hash) ? hash : 'kanban';
      if (shouldCancelImportOnNavigation(importTabRef.current, nextTab)) cancelDocumentImport();
      if (currentUser?.roleCode === 'super_admin') {
        setInlineChatDriverId(null);
        setActiveTab('profile');
        window.history.replaceState(null, '', '#profile');
        return;
      }
      if (tabs.includes(hash)) {
        setInlineChatDriverId(null);
        if (hash === 'chat') setChatWasOpened(true);
        if (hash === 'map') setMapWasOpened(true);
        setActiveTab(hash);
        return;
      }
      setInlineChatDriverId(null);
      setActiveTab('kanban');
      window.history.replaceState(null, '', '#kanban');
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [currentUser?.roleCode, cancelDocumentImport]);

  useEffect(() => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return undefined;
    workspaceActiveRef.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize the authenticated workspace with remote data.
    refreshWorkspace();
    let active = true;
    const updatePresence = payload => {
      if (!active) return;
      const row = payload?.new;
      const id = row?.driver_id || payload?.old?.driver_id;
      if (!id) return;
      const latest = presenceUpdatesRef.current.get(id);
      if (payload.eventType !== 'DELETE' && latest && presenceTimestamp(latest) > presenceTimestamp(row)) return;
      presenceUpdatesRef.current.set(id, payload.eventType === 'DELETE' ? null : row);
      setDrivers(previous => refreshDriverPresence(previous, presenceUpdatesRef.current));
    };
    const refreshPresence = createCoalescedAsyncTrigger(async () => {
      try {
        const atStart = new Map(presenceUpdatesRef.current);
        const rows = await fetchDriverPresence();
        if (!active) return;
        // Realtime events during an HTTP read win, including DELETE and offline
        // writes which retained the same last_seen_at value.
        presenceUpdatesRef.current = mergePresenceSnapshot(presenceUpdatesRef.current, atStart, rows);
        setDrivers(previous => refreshDriverPresence(previous, presenceUpdatesRef.current));
      } catch { /* Keep last known data; the local TTL still expires online state. */ }
    });
    const unsubscribe = subscribeWorkspace(() => refreshWorkspace({ quiet: true }), updatePresence);
    // Presence expires without a database event. A foreground wake also handles
    // suspended background timers; the occasional small read repairs missed events.
    const expirePresence = () => setDrivers(previous => refreshDriverPresence(previous));
    const onVisible = () => {
      if (document.visibilityState === 'visible') { expirePresence(); refreshPresence(); }
    };
    const expiryTimer = window.setInterval(expirePresence, 15_000);
    const reconcileTimer = window.setInterval(refreshPresence, 120_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      active = false;
      workspaceActiveRef.current = false;
      workspaceGenerationRef.current += 1;
      unsubscribe();
      refreshPresence.dispose();
      window.clearInterval(expiryTimer);
      window.clearInterval(reconcileTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [currentUserId, currentUserRoleCode, refreshWorkspace]);

  useEffect(() => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return undefined;
    // oxlint-disable-next-line react/set-state-in-effect -- subscribe and load the external unread count.
    refreshUnreadChats();
    return subscribeUnreadChats(refreshUnreadChats);
  }, [currentUserId, currentUserRoleCode, refreshUnreadChats]);

  // A lightweight call listener exists before the heavier chat UI is first opened.
  useEffect(() => {
    if (!currentUserId || chatWasOpened || ['driver', 'super_admin'].includes(currentUserRoleCode)) return;
    let active = true;
    let pending = false;
    const wake = (call) => { if (active && call?.recipient_id === currentUserId && call.status === 'ringing') setChatWasOpened(true); };
    const refresh = async () => {
      if (!active || pending) return;
      pending = true;
      try { (await fetchRingingCalls()).forEach(wake); } catch { /* Reconnect and foreground retry. */ }
      finally { pending = false; }
    };
    const off = subscribeCalls({ onCall: wake, onReconnect: refresh });
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; off(); window.removeEventListener('online', visible); document.removeEventListener('visibilitychange', visible); };
  }, [currentUserId, currentUserRoleCode, chatWasOpened]);

  useEffect(() => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return undefined;
    let active = true;
    const refresh = createCoalescedAsyncTrigger(async () => {
      try {
        const count = await fetchBrokerInboxUnreadCount();
        if (active) setUnreadInboxCount(count);
      } catch { /* Keep the last badge while reconnecting. */ }
    });
    // Initial fetch, polling, read receipts and Realtime all share one queue.
    inboxRefreshRef.current = refresh;
    refresh();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const channel = supabase.channel('broker-inbox-badge');
    for (const table of ['broker_attachments', 'broker_message_reads']) {
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table }, refresh);
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, refresh);
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') refresh();
    });
    return () => {
      active = false;
      inboxRefreshRef.current = null;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      refresh.dispose();
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, currentUserRoleCode]);

  const handleSelectTab = useCallback((tab) => {
    if (currentUser?.roleCode === 'super_admin' && tab !== 'profile') return;
    if (tab === 'chat') setChatWasOpened(true);
    if (tab === 'map') setMapWasOpened(true);
    setInlineChatDriverId(null);
    cancelDocumentImport();
    if (tab !== 'profile') setProfileEditDriverId(null);
    if (tab !== 'profile') { setSelectedDriverId(null); setDriverProfileRequest(0); }
    setActiveTab(tab);
    window.location.hash = tab;
  }, [currentUser, cancelDocumentImport]);

  const handleOpenDriverProfile = useCallback((driverOrId) => {
    const driverId = typeof driverOrId === 'string' ? driverOrId : driverOrId?.id;
    setSelectedDriverId(driverId || null);
    // A repeated request must also leave Settings/Integrations for the driver.
    setDriverProfileRequest(request => request + 1);
    handleSelectTab('profile');
  }, [handleSelectTab]);

  const handleOpenDriverChat = useCallback((driver) => {
    setChatDriverId(driver.id);
    setChatSelectionRequest((value) => value + 1);
    handleSelectTab('chat');
  }, [handleSelectTab]);

  const handleOpenInlineChat = useCallback((driver) => {
    setChatWasOpened(true);
    setChatDriverId(driver.id);
    setInlineChatDriverId(driver.id);
    setChatSelectionRequest((value) => value + 1);
  }, []);

  const handleCreateLoad = async (newLoad) => {
    setOperationLoading(true);
    let loadId;
    try {
      loadId = await createManualLoad(newLoad);
    } catch (error) {
      if (error.loadId) {
        await refreshWorkspace({ quiet: true });
        setIsCreateModalOpen(false);
        setSelectedDriverForLoad(null);
        handleSelectTab('kanban');
        setDraftRecoveryRequest(request => request + 1);
        showToast(t('toasts.loadSavedApprovalFailed'));
        return;
      }
      showToast(localizedError(t, error, 'errors.createLoad'));
      throw error;
    } finally {
      setOperationLoading(false);
    }

    setIsCreateModalOpen(false);
    setSelectedDriverForLoad(null);

    setOperationLoading(true);
    try {
      await assignLoadDirectly(loadId, newLoad.targetDriverIds[0]);
      showToast(t('loads.assignedDirectly'));
    } catch (error) {
      handleSelectTab('kanban');
      setDraftRecoveryRequest(request => request + 1);
      showToast(t('toasts.loadSavedOfferFailed', {
        reason: localizedError(t, error, 'errors.createLoad'),
      }));
    } finally {
      await refreshWorkspace({ quiet: true });
      setOperationLoading(false);
    }
  };

  const handleOpenCreateLoad = (driver = null) => {
    setSelectedDriverForLoad(driver);
    setIsCreateModalOpen(true);
  };

  const handleCloseCreateLoad = useCallback(() => {
    setIsCreateModalOpen(false);
    setSelectedDriverForLoad(null);
  }, []);

  const handleCreateMember = async (member) => {
    await createMember({
      email: member.email,
      password: member.password,
      fullName: member.name,
      phone: member.phone,
      role: member.role || 'driver',
      gmailLabel: member.gmailLabel,
      companyId: currentUser.companyId,
    });
    await refreshWorkspace({ quiet: true });
  };

  const handleDeleteMember = async (member) => {
    setOperationLoading(true);
    try {
      await deleteCompanyMember(member.id);
      await refreshWorkspace({ quiet: true });
      showToast(t('toasts.memberDeleted', { name: member.name }));
      return true;
    } catch (error) {
      showToast(localizedError(t, error, 'errors.memberDelete'));
      return false;
    } finally {
      setOperationLoading(false);
    }
  };

  const handleAiDocument = async (file, preferredDriverId = null, brokerSource = null, selectDriverFirst = false) => {
    if ((!file && !brokerSource) || importRunnerRef.current.busy) return;
    const fileError = brokerSource ? null : loadImportFileError(file);
    if (fileError) {
      showToast(t(`errors.${fileError}`));
      return;
    }
    importFileRef.current = file;
    importTabRef.current = brokerSource ? 'drivers' : activeTab;
    const importRequestId = crypto.randomUUID();
    const sourceUrl = file ? URL.createObjectURL(file) : null;
    const importContext = {
      source: 'document', importRequestId, preferredDriverId, sourceUrl,
      awaitingDriverSelection: selectDriverFirst,
      fileName: file?.name || brokerSource.fileName,
      ...(brokerSource ? {
        sourceKind: 'broker', brokerMessageId: brokerSource.messageId,
        brokerAttachmentId: brokerSource.attachmentId,
      } : {}),
    };
    setAiPreparedLoad(importContext);
    setAiProcessing(true);
    return importRunnerRef.current.run({
      prepare: () => brokerSource
        ? prepareLoadFromBrokerAttachment(brokerSource)
        : prepareLoadFromDocument(file),
      onResult: (result) => {
        importFileRef.current = result.file || file;
        const existingLoad = findExistingFinalizedLoad(loads, result.preparedLoad.loadNumber);
        const preparedResult = existingLoad
          ? { ...result, preparedLoad: { ...result.preparedLoad, existingFinalizedLoadId: existingLoad.id } }
          : result;
        setAiPreparedLoad(current => mergeDocumentImportResult(current, importRequestId, preparedResult));
        // A preview has no database/media write, so there is nothing to refresh.
        const warningCount = result.preparedLoad.missingFields?.length || 0;
        showToast(
          existingLoad
            ? t('importReview.duplicateLoad')
            : result.duplicate
            ? t('toasts.duplicateDocument')
            : warningCount
              ? t('toasts.aiPreparedWarnings', { count: warningCount })
              : t('toasts.aiPrepared'),
        );
      },
      onError: (error) => {
        const importError = localizedError(t, error, 'errors.documentAnalysis');
        setAiPreparedLoad(current => current?.importRequestId === importRequestId ? { ...current, importError } : current);
        showToast(importError);
      },
      onFinish: () => setAiProcessing(false),
    });
  };

  const handleBrokerAttachment = async (message, attachment, preferredDriverId) => {
    if (!message?.id || !attachment?.id || !preferredDriverId || importRunnerRef.current.busy) return;
    setInlineChatDriverId(null);
    setSelectedDriverId(preferredDriverId);
    setActiveTab('drivers');
    window.location.hash = 'drivers';
    await handleAiDocument(null, preferredDriverId, {
      messageId: message.id, attachmentId: attachment.id, fileName: attachment.file_name,
    });
  };

  const handleLoadTrashAction = async (action, load, driverId = null) => {
    setOperationLoading(true);
    try {
      const row = await runLoadTrashAction(supabase, action, load, driverId);
      // Reconcile the confirmed mutation immediately, even if the subsequent
      // workspace refresh is offline. Never remove anything before RPC success.
      const saved = row && {
        ...load, ...loadTrashMetadata(row), version: row.version,
        databaseStatus: row.status, status: loadBoardStatus(row),
        driverId: action === 'restore' ? driverId : null,
        targetDriverIds: action === 'restore' && driverId ? [driverId] : [],
      };
      setLoads(current => action === 'restore'
        ? [saved, ...current.filter(item => item.id !== load.id)]
        : current.filter(item => item.id !== load.id));
      setTrashedLoads(current => action === 'trash'
        ? [saved, ...current.filter(item => item.id !== load.id)]
        : current.filter(item => item.id !== load.id));
      setAiPreparedLoad((current) => current?.id === load.id ? null : current);
      setSelectedLoadForDocs((current) => current?.id === load.id ? null : current);
      await refreshWorkspace({ quiet: true });
      showToast(t(`loadTrash.${action === 'trash' ? 'moved' : action === 'restore' ? 'restored' : 'deleted'}`, { number: load.loadNumber }));
    } catch (error) {
      // Conflict refresh must not replay the mutation with a new version.
      if (/LOAD_(?:TRASH_(?:CONFLICT|NOT_FOUND)|ALREADY_TRASHED|NOT_TRASHED|TRASHED)/.test(error?.message || '')) {
        await refreshWorkspace({ quiet: true });
      }
      throw error;
    } finally {
      setOperationLoading(false);
    }
  };
  const canManageLoads = ['company_admin', 'dispatcher'].includes(currentUser?.roleCode);
  const handleTrashLoad = canManageLoads ? (load) => handleLoadTrashAction('trash', load) : undefined;

  const handleSendAiOffer = async (driverIds) => {
    if (!aiPreparedLoad) return;
    setOperationLoading(true);
    try {
      const preparedLoad = aiPreparedLoad;
      if (preparedLoad.previewTicket) {
        await sendPreviewDocumentLoad(importFileRef.current, preparedLoad.previewTicket, driverIds[0], {
          brokerMessageId: preparedLoad.brokerMessageId,
          brokerAttachmentId: preparedLoad.brokerAttachmentId,
        });
      } else if (preparedLoad.source === 'saved' && isRecoverableLoad(preparedLoad)) {
        await recoverSavedLoad(preparedLoad, driverIds[0], {
          approve: approveLoadDraft, assign: assignLoadDirectly, review: reviewAndAssignDocumentLoad,
        });
      } else if (preparedLoad.review?.required) {
        await reviewAndAssignDocumentLoad(preparedLoad.id, driverIds[0], preparedLoad.review.checksum);
      } else {
        await assignLoadDirectly(preparedLoad.id, driverIds[0]);
      }
      await refreshWorkspace({ quiet: true });
      importFileRef.current = null;
      importTabRef.current = null;
      setAiPreparedLoad(null);
      showToast(t('loads.assignedDirectly'));
      return true;
    } catch (error) {
      const message = localizedError(t, error, 'errors.createLoad');
      if ((aiPreparedLoad?.source === 'saved' && isRecoverableLoad(aiPreparedLoad)) || /ASSIGN_FAILED_DRAFT_SAVED/.test(error?.code || '') || /ASSIGN_FAILED_DRAFT_SAVED/.test(error?.message || '')) {
        await refreshWorkspace({ quiet: true });
        handleSelectTab('kanban');
        setDraftRecoveryRequest(request => request + 1);
      }
      showToast(message);
      return message;
    } finally {
      setOperationLoading(false);
    }
  };

  const filteredLoads = useMemo(() => loads.filter((load) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const driver = drivers.find((item) => item.id === load.driverId);
    return [
      load.loadNumber,
      load.broker,
      load.origin?.city,
      load.origin?.state,
      load.destination?.city,
      load.destination?.state,
      driver?.name,
    ].some((value) => value?.toLowerCase().includes(query));
  }), [loads, drivers, searchQuery]);

  const globalSearchResults = useMemo(() => buildGlobalSearchResults({
    query: searchQuery,
    loads,
    drivers,
    t,
    locale: i18n.resolvedLanguage || i18n.language,
  }), [drivers, i18n.language, i18n.resolvedLanguage, loads, searchQuery, t]);

  const handleSelectSearchResult = useCallback((result) => {
    if (result.type === 'driver') {
      handleOpenDriverProfile(result.entityId);
    } else if (result.type === 'load') {
      const load = loads.find((item) => item.id === result.entityId);
      if (load) {
        handleOpenDocs(load);
        handleSelectTab('docs');
      }
    } else if (result.type === 'page') {
      if (result.tab === 'drivers') setSelectedDriverId(null);
      if (result.tab === 'docs') setSelectedLoadForDocs(null);
      handleSelectTab(result.tab);
    }
    setSearchQuery('');
  }, [handleOpenDocs, handleOpenDriverProfile, handleSelectTab, loads]);

  const metrics = useMemo(() => {
    const activeLoadsCount = loads.filter((load) => !['COMPLETED'].includes(load.status)).length;
    const totalRevenue = loads.reduce((sum, load) => sum + (load.rate || 0), 0);
    const totalMiles = loads.reduce((sum, load) => sum + (load.distanceMiles || 0), 0);
    return {
      activeLoadsCount,
      totalRevenue,
      avgRPM: totalMiles ? (totalRevenue / totalMiles).toFixed(2) : '0.00',
    };
  }, [loads]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center text-zinc-600 dark:text-zinc-300">
        <LoaderCircle className="w-7 h-7 animate-spin mr-3" />
        <span className="font-semibold">{t('auth.checking')}</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LazyRouteBoundary key="auth">
        <React.Suspense fallback={<div className="grid min-h-screen place-items-center"><LoaderCircle className="h-7 w-7 animate-spin" /></div>}>
          <AuthView
            onLogin={login}
            externalError={!configured ? t('errors.supabaseConfig') : authError && localizedError(t, new Error(authError))}
            theme={theme}
            toggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
          />
        </React.Suspense>
      </LazyRouteBoundary>
    );
  }

  if (currentUser.roleCode === 'driver') {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 text-center shadow-xl">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">{t('auth.driverMobile')}</h1>
          <p className="text-sm text-zinc-500 mt-2">{t('auth.webForStaff')}</p>
          <button onClick={logout} className="mt-6 px-5 py-2.5 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 font-bold">
            {t('nav.logout')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-shell flex h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans transition-colors">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        onPrefetch={(tab) => { void prefetchRoute(tab)?.catch(() => {}); }}
        loadsCount={loads.filter(load => load.status !== 'UNASSIGNED').length}
        unreadChatCount={unreadChatCount}
        unreadInboxCount={unreadInboxCount}
        onDropFile={() => showToast(t('toasts.brokerFilesAutomatic'))}
        currentUser={currentUser}
        onLogout={logout}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {activeTab !== 'chat' && (
          <TopHeader
            activeTab={activeTab}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchResults={globalSearchResults}
            onSelectSearchResult={handleSelectSearchResult}
            onOpenCreateModal={currentUser.roleCode === 'super_admin' ? undefined : () => handleOpenCreateLoad()}
            activeLoadsCount={metrics.activeLoadsCount}
            totalRevenue={metrics.totalRevenue}
            avgRPM={metrics.avgRPM}
            theme={theme}
            toggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            onExitDriver={activeTab === 'drivers' && selectedDriverId
              ? () => inlineChatVisible ? setInlineChatDriverId(null) : setSelectedDriverId(null)
              : undefined}
            selectedDriver={activeTab === 'drivers' ? selectedDriver : null}
            onOpenDriverChat={selectedDriver ? () => handleOpenInlineChat(selectedDriver) : undefined}
            selectedDriverUnreadCount={selectedDriver ? unreadChatsByDriver[selectedDriver.id] || 0 : 0}
          />
        )}

        {(toast.show || workspaceError) && (
          <div className="px-5 pt-2.5">
            <div className={`${workspaceError ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300' : 'border-zinc-200 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300'} bg-white dark:bg-zinc-900 border rounded-lg px-3 py-2 flex items-center justify-between text-xs shadow-xs`}>
              <span>{workspaceError || toast.message}</span>
              <button onClick={() => { setToast((value) => ({ ...value, show: false })); setWorkspaceError(''); }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <main className={`workspace-main min-h-0 flex-1 relative ${activeTab === 'chat' || inlineChatVisible ? 'workspace-main-chat' : activeTab === 'map' ? 'workspace-main-map' : importPageVisible ? 'workspace-main-import' : activeTab === 'analytics' ? 'workspace-main-analytics' : activeTab === 'drivers' && !selectedDriverId ? 'workspace-main-drivers' : 'overflow-y-auto p-5 space-y-4'}`}>
          {((refreshLoading && !workspaceReady) || operationLoading) && !importPageVisible && (
            <div className="absolute inset-0 z-30 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-[1px] flex items-center justify-center">
              <LoaderCircle className="w-7 h-7 animate-spin text-zinc-700 dark:text-zinc-300" />
            </div>
          )}
          <LazyRouteBoundary key={activeTab}>
          <React.Suspense fallback={<div className="grid min-h-48 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin" /></div>}>
          {importPageVisible ? <ImportedLoadPage
            key={aiPreparedLoad.importRequestId}
            load={aiPreparedLoad}
            processing={aiProcessing}
            drivers={drivers}
            onBack={cancelDocumentImport}
            onRetry={() => aiPreparedLoad.sourceKind === 'broker'
              ? handleBrokerAttachment(
                  { id: aiPreparedLoad.brokerMessageId },
                  { id: aiPreparedLoad.brokerAttachmentId, file_name: aiPreparedLoad.fileName },
                  aiPreparedLoad.preferredDriverId,
                )
              : handleAiDocument(importFileRef.current, aiPreparedLoad.preferredDriverId)}
            onConfirm={handleSendAiOffer}
          /> : <>
          {activeTab === 'kanban' && (
            <LoadsWorkspace
              loads={filteredLoads}
              recoveryRequest={draftRecoveryRequest}
              recoveryLoads={loads}
              drivers={drivers}
              onAdvanceStatus={() => showToast(t('toasts.statusFromMobile'))}
              onOpenDocs={handleOpenDocs}
              onTrashLoad={handleTrashLoad}
              trashedLoads={trashedLoads}
              onRestoreLoad={canManageLoads ? (load, driverId) => handleLoadTrashAction('restore', load, driverId) : undefined}
              onPermanentlyDeleteLoad={canManageLoads ? (load) => handleLoadTrashAction('delete', load) : undefined}
              onSendOffer={(load) => setAiPreparedLoad({ ...load, lifecycleStatus: load.databaseStatus, source: 'saved' })}
              onDropOnOffer={(file) => handleAiDocument(file, null, null, true)}
              isAiProcessing={aiProcessing}
            />
          )}
          {activeTab === 'analytics' && <AnalyticsOverview />}
          {activeTab === 'drivers' && !inlineChatVisible && (
            <DriverRoster
              drivers={drivers}
              loads={loads}
              onAssignLoad={handleOpenCreateLoad}
              onOpenChat={handleOpenDriverChat}
              onOpenDocs={handleOpenDocs}
              onTrashLoad={handleTrashLoad}
              onImportDriverDocument={(file, driverId) => handleAiDocument(file, driverId)}
              isAiProcessing={aiProcessing}
              unreadChatsByDriver={unreadChatsByDriver}
              selectedDriverId={selectedDriverId}
              onSelectDriver={setSelectedDriverId}
            />
          )}
          {activeTab === 'docs' && <DocumentsView loads={loads} drivers={drivers} onOpenDocs={handleOpenDocs} />}
          {activeTab === 'inbox' && (
            <BrokerInbox
              drivers={drivers}
              onUnreadChange={refreshUnreadInbox}
              onPrepareAttachment={handleBrokerAttachment}
            />
          )}
          {activeTab === 'profile' && (
            currentUser.roleCode === 'super_admin' ? <PlatformAdminPanel onLogout={logout} /> : (
          <ProfileView
            key={driverProfileRequest}
            initialSection={driverProfileRequest ? 'company' : undefined}
            browserPush={browserPush}
            onSaveProfile={auth.updateProfile}
                drivers={drivers}
                members={members}
                loads={loads}
                onAddDriver={handleCreateMember}
                onDeleteMember={currentUser.roleCode === 'company_admin' ? handleDeleteMember : undefined}
                currentUser={currentUser}
                onNavigate={handleSelectTab}
                onOpenDriver={handleOpenDriverProfile}
                selectedDriverId={selectedDriverId}
                onAssignDriverLoad={handleOpenCreateLoad}
                onOpenDriverChat={handleOpenDriverChat}
                onOpenDriverLoad={handleOpenDocs}
                theme={theme}
                toggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
                unreadChatCount={unreadChatCount}
                unreadInboxCount={unreadInboxCount}
                locale={i18n.resolvedLanguage || i18n.language}
                onLocaleChange={handleLocaleChange}
                timeZone={displayTimeZone}
                onTimeZoneChange={(zone) => {
                  const saved = setDisplayTimeZone(zone);
                  showToast(t(saved ? 'profile.timeZoneSaved' : 'profile.timeZoneSessionOnly'));
                }}
                onWorkspaceRefresh={() => refreshWorkspace({ quiet: true })}
                initialDriverToEditId={profileEditDriverId}
                onEditDriverClosed={() => setProfileEditDriverId(null)}
              />
            )
          )}
          </>}
          </React.Suspense>
          </LazyRouteBoundary>
          {mapWasOpened && <div className={activeTab === 'map' && !importPageVisible ? 'h-full min-h-0' : 'hidden'}>
            <LazyRouteBoundary>
              <React.Suspense fallback={<div className="grid h-full place-items-center"><LoaderCircle className="h-7 w-7 animate-spin" /></div>}>
                <FleetMap drivers={drivers} loads={loads} isVisible={activeTab === 'map' && !importPageVisible} onOpenDocs={handleOpenDocs} onTrashLoad={handleTrashLoad} />
              </React.Suspense>
            </LazyRouteBoundary>
          </div>}
          {chatWasOpened && <div className={activeTab === 'chat' || inlineChatVisible ? 'h-full min-h-0' : 'hidden'}>
            <LazyRouteBoundary>
              <React.Suspense fallback={<div className="dispatch-chat-workspace grid h-full place-items-center"><LoaderCircle className="h-7 w-7 animate-spin" /></div>}>
                <DispatchChat
                  drivers={drivers}
                  currentUser={currentUser}
                  isVisible={activeTab === 'chat' || inlineChatVisible}
                  activeChatDriver={drivers.find((driver) => driver.id === chatDriverId)}
                  selectionRequestKey={chatSelectionRequest}
                  onUnreadChange={refreshUnreadChats}
                  compact={inlineChatVisible}
                  onClose={() => setInlineChatDriverId(null)}
                />
              </React.Suspense>
            </LazyRouteBoundary>
          </div>}
        </main>
      </div>

      <LazyRouteBoundary key={`modal:${isCreateModalOpen}:${Boolean(aiPreparedLoad)}:${Boolean(selectedLoadForDocs)}`}>
        <React.Suspense fallback={null}>
          {isCreateModalOpen && <CreateLoadModal
            key={selectedDriverForLoad?.id || 'all-drivers'}
            isOpen={isCreateModalOpen}
            onClose={handleCloseCreateLoad}
            drivers={drivers}
            onCreateLoad={handleCreateLoad}
            onDocument={(file, driverId) => { handleCloseCreateLoad(); return handleAiDocument(file, driverId, null, activeTab === 'kanban' && !driverId); }}
            initialDriverId={selectedDriverForLoad?.id || null}
          />}
          {importDriverPickerVisible && <ImportDriverPicker
            key={aiPreparedLoad.importRequestId}
            drivers={drivers}
            fileName={aiPreparedLoad.fileName}
            processing={aiProcessing}
            error={aiPreparedLoad.importError}
            selectedDriverId={aiPreparedLoad.preferredDriverId}
            onSelectDriver={(driverId) => setAiPreparedLoad(current => current?.source === 'document'
              ? continueDocumentImport({ ...current, preferredDriverId: driverId }, drivers) : current)}
            onCancel={cancelDocumentImport}
            onRetry={() => handleAiDocument(importFileRef.current, aiPreparedLoad.preferredDriverId, null, true)}
          />}
          {aiPreparedLoad?.source === 'saved' && <QuickDriverModal
            key={aiPreparedLoad?.id || aiPreparedLoad?.brokerMessageId || 'closed'}
            isOpen
            onClose={() => setAiPreparedLoad(null)}
            loadData={aiPreparedLoad}
            drivers={drivers}
            initialDriverId={aiPreparedLoad.preferredDriverId}
            onOpenDocs={handleOpenDocs}
            onConfirm={handleSendAiOffer}
          />}
          {selectedLoadForDocs && <DocumentViewerModal
            isOpen
            onClose={() => setSelectedLoadForDocs(null)}
            load={selectedLoadForDocs}
            initialDocumentTab={selectedDocumentTab}
          />}
        </React.Suspense>
      </LazyRouteBoundary>
    </div>
  );
}
