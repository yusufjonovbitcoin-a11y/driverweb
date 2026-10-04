import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import LazyRouteBoundary from './components/LazyRouteBoundary';
import { useAuth } from './hooks/useAuth';
import { WorkspaceCache, useWorkspaceInvalidation } from './hooks/WorkspaceCache';
import {
  createManualLoad,
  prepareLoadFromDocument,
  prepareLoadFromBrokerAttachment,
  sendPreviewDocumentLoad,
  assignLoadDirectly,
  reviewAndAssignDocumentLoad,
  deleteUnassignedLoad,
  fetchWorkspace,
  createMember,
  deleteCompanyMember,
  fetchBrokerInboxUnreadCount,
  subscribeWorkspace,
  updateMyLocale,
} from './services/operationsService';
import {
  fetchUnreadChatCountsByDriver,
  subscribeUnreadChats,
} from './services/chatService';
import { buildGlobalSearchResults } from './utils/globalSearch';
import { localizedError } from './i18n/errors';
import { loadImportFileError } from './services/loadImportFile';
import { setAppLocale } from './i18n';
import { changeLocaleWithProfileSync } from './i18n/localeSync';
import { supabase } from './lib/supabase';
import { createCoalescedAsyncTrigger } from './services/realtimeRefresh';
import { createSerializedRefresh } from './services/serializedRefresh';
import {
  clearPendingLocaleOverride,
  persistPendingLocaleOverride,
  resolveLocaleForProfile,
} from './i18n/locales';

const tabs = ['kanban', 'drivers', 'map', 'analytics', 'docs', 'inbox', 'chat', 'profile'];
const routeLoaders = {
  analytics: () => import('./components/AnalyticsOverview'),
  chat: () => import('./components/DispatchChat'),
  kanban: () => import('./components/KanbanBoard'),
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
const KanbanBoard = React.lazy(routeLoaders.kanban);
const FleetMap = React.lazy(routeLoaders.map);
const DriverRoster = React.lazy(routeLoaders.drivers);
const CreateLoadModal = React.lazy(() => import('./components/CreateLoadModal'));
const QuickDriverModal = React.lazy(() => import('./components/QuickDriverModal'));
const ImportedLoadPage = React.lazy(() => import('./components/ImportedLoadPage'));
const DocumentViewerModal = React.lazy(() => import('./components/DocumentViewerModal'));
const ProfileView = React.lazy(routeLoaders.profile);
const DocumentsView = React.lazy(routeLoaders.docs);
const BrokerInbox = React.lazy(routeLoaders.inbox);
const PlatformAdminPanel = React.lazy(() => import('./components/PlatformAdminPanel'));

export default function App() {
  const auth = useAuth();
  const scope = JSON.stringify([auth.currentUser?.id, auth.currentUser?.companyId, auth.currentUser?.roleCode]);
  return <WorkspaceCache key={scope}><Workspace auth={auth} /></WorkspaceCache>;
}

function Workspace({ auth }) {
  const { t, i18n } = useTranslation();
  const invalidate = useWorkspaceInvalidation();
  const querySourcesRef = useRef('');
  const { currentUser, loading: authLoading, configured, authError, login, logout } = auth;
  const [activeTab, setActiveTab] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return tabs.includes(hash) ? hash : 'kanban';
  });
  const [loads, setLoads] = useState([]);
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
  const [profileEditDriverId, setProfileEditDriverId] = useState(null);
  const [chatDriverId, setChatDriverId] = useState(null);
  const [chatSelectionRequest, setChatSelectionRequest] = useState(0);
  const [chatWasOpened, setChatWasOpened] = useState(() => window.location.hash === '#chat');
  const [mapWasOpened, setMapWasOpened] = useState(() => window.location.hash === '#map');
  const [inlineChatDriverId, setInlineChatDriverId] = useState(null);
  const [aiPreparedLoad, setAiPreparedLoad] = useState(null);
  const importFileRef = useRef(null);
  const importBusyRef = useRef(false);
  const importPageVisible = aiPreparedLoad?.source === 'document';
  const importSourceUrl = aiPreparedLoad?.sourceUrl;
  useEffect(() => () => {
    if (importSourceUrl?.startsWith('blob:')) URL.revokeObjectURL(importSourceUrl);
  }, [importSourceUrl]);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [selectedLoadForDocs, setSelectedLoadForDocs] = useState(null);
  const [selectedDocumentTab, setSelectedDocumentTab] = useState('rateCon');
  const [toast, setToast] = useState({ show: false, message: '' });
  const [theme, setTheme] = useState(() => localStorage.getItem('apex_theme') || 'light');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadChatsByDriver, setUnreadChatsByDriver] = useState({});
  const [unreadInboxCount, setUnreadInboxCount] = useState(0);
  const inboxRefreshRef = useRef(null);
  const workspaceActiveRef = useRef(true);
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
    try {
      const workspace = await fetchWorkspace();
      if (!workspaceActiveRef.current) return;
      const querySources = JSON.stringify([
        workspace.loads.map(load => [load.id, load.status, load.rate, load.distanceMiles, load.driverId]),
        workspace.drivers.map(driver => [driver.id, driver.truck, driver.trailer]),
      ]);
      if (querySourcesRef.current && querySourcesRef.current !== querySources) {
        void invalidate(key => key === 'fleet-vehicles'
          || (Array.isArray(key) && ['trip-analytics', 'driver-sessions'].includes(key[0]))).catch(() => {});
      }
      querySourcesRef.current = querySources;
      setLoads(workspace.loads);
      setDrivers(workspace.drivers);
      setMembers(workspace.members);
      setWorkspaceError('');
    } catch (error) {
      if (workspaceActiveRef.current) setWorkspaceError(localizedError(t, error, 'errors.workspace'));
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
          setWorkspaceReady(true);
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
      if (currentUser?.roleCode === 'super_admin') {
        setInlineChatDriverId(null);
        setActiveTab('profile');
        window.history.replaceState(null, '', '#profile');
        return;
      }
      const hash = window.location.hash.replace('#', '');
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
  }, [currentUser?.roleCode]);

  useEffect(() => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return undefined;
    workspaceActiveRef.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize the authenticated workspace with remote data.
    refreshWorkspace();
    const unsubscribe = subscribeWorkspace(() => refreshWorkspace({ quiet: true }));
    return () => {
      workspaceActiveRef.current = false;
      unsubscribe();
    };
  }, [currentUserId, currentUserRoleCode, refreshWorkspace]);

  useEffect(() => {
    if (!currentUserId || ['driver', 'super_admin'].includes(currentUserRoleCode)) return undefined;
    // oxlint-disable-next-line react/set-state-in-effect -- subscribe and load the external unread count.
    refreshUnreadChats();
    return subscribeUnreadChats(refreshUnreadChats);
  }, [currentUserId, currentUserRoleCode, refreshUnreadChats]);

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
    setAiPreparedLoad(null);
    if (tab !== 'profile') setProfileEditDriverId(null);
    if (tab !== 'profile') setSelectedDriverId(null);
    setActiveTab(tab);
    window.location.hash = tab;
  }, [currentUser]);

  const handleOpenDriverProfile = useCallback((driverOrId) => {
    const driverId = typeof driverOrId === 'string' ? driverOrId : driverOrId?.id;
    setSelectedDriverId(driverId || null);
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
    if (!newLoad.targetDriverIds.length) {
      await refreshWorkspace({ quiet: true });
      showToast(t('toasts.loadSaved'));
      return;
    }

    setOperationLoading(true);
    try {
      await assignLoadDirectly(loadId, newLoad.targetDriverIds[0]);
      showToast(t('loads.assignedDirectly'));
    } catch (error) {
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

  const handleAiDocument = async (file, preferredDriverId = null, brokerSource = null) => {
    if ((!file && !brokerSource) || importBusyRef.current) return;
    const fileError = brokerSource ? null : loadImportFileError(file);
    if (fileError) {
      showToast(t(`errors.${fileError}`));
      return;
    }
    importBusyRef.current = true;
    importFileRef.current = file;
    const importRequestId = crypto.randomUUID();
    const sourceUrl = file ? URL.createObjectURL(file) : null;
    const importContext = {
      source: 'document', importRequestId, preferredDriverId, sourceUrl,
      fileName: file?.name || brokerSource.fileName,
      ...(brokerSource ? {
        sourceKind: 'broker', brokerMessageId: brokerSource.messageId,
        brokerAttachmentId: brokerSource.attachmentId,
      } : {}),
    };
    setAiPreparedLoad(importContext);
    setAiProcessing(true);
    setOperationLoading(true);
    try {
      const result = brokerSource
        ? await prepareLoadFromBrokerAttachment(brokerSource)
        : await prepareLoadFromDocument(file);
      importFileRef.current = result.file || file;
      setAiPreparedLoad(current => current?.importRequestId === importRequestId
        ? { ...result.preparedLoad, ...importContext, sourceUrl: result.sourceUrl || sourceUrl } : current);
      // A preview has no database/media write, so there is nothing to refresh.
      const warningCount = result.preparedLoad.missingFields?.length || 0;
      showToast(
        result.duplicate
          ? t('toasts.duplicateDocument')
          : warningCount
            ? t('toasts.aiPreparedWarnings', { count: warningCount })
            : t('toasts.aiPrepared'),
      );
    } catch (error) {
      const importError = localizedError(t, error, 'errors.documentAnalysis');
      setAiPreparedLoad(current => current?.importRequestId === importRequestId ? { ...current, importError } : current);
      showToast(importError);
    } finally {
      importBusyRef.current = false;
      setAiProcessing(false);
      setOperationLoading(false);
    }
  };

  const handleBrokerAttachment = async (message, attachment, preferredDriverId) => {
    if (!message?.id || !attachment?.id || !preferredDriverId || importBusyRef.current) return;
    setInlineChatDriverId(null);
    setSelectedDriverId(preferredDriverId);
    setActiveTab('drivers');
    window.location.hash = 'drivers';
    await handleAiDocument(null, preferredDriverId, {
      messageId: message.id, attachmentId: attachment.id, fileName: attachment.file_name,
    });
  };

  const handleDeleteLoad = async (load) => {
    setOperationLoading(true);
    try {
      await deleteUnassignedLoad(load.id);
      setAiPreparedLoad((current) => current?.id === load.id ? null : current);
      setSelectedLoadForDocs((current) => current?.id === load.id ? null : current);
      await refreshWorkspace({ quiet: true });
      showToast(t('toasts.loadDeleted', { number: load.loadNumber }));
    } catch (error) {
      showToast(localizedError(t, error, 'errors.deleteLoad'));
      throw error;
    } finally {
      setOperationLoading(false);
    }
  };

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
      } else if (preparedLoad.review?.required) {
        await reviewAndAssignDocumentLoad(preparedLoad.id, driverIds[0], preparedLoad.review.checksum);
      } else {
        await assignLoadDirectly(preparedLoad.id, driverIds[0]);
      }
      await refreshWorkspace({ quiet: true });
      importFileRef.current = null;
      setAiPreparedLoad(null);
      showToast(t('loads.assignedDirectly'));
      return true;
    } catch (error) {
      const message = localizedError(t, error, 'errors.createLoad');
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
        loadsCount={loads.length}
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
          {(refreshLoading || operationLoading) && !importPageVisible && (
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
            onBack={() => { importFileRef.current = null; setAiPreparedLoad(null); }}
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
            <KanbanBoard
              loads={filteredLoads}
              drivers={drivers}
              onAdvanceStatus={() => showToast(t('toasts.statusFromMobile'))}
              onOpenDocs={handleOpenDocs}
              onDeleteLoad={handleDeleteLoad}
              onSendOffer={(load) => setAiPreparedLoad({ ...load, lifecycleStatus: load.databaseStatus, source: 'saved' })}
              onDropOnOffer={handleAiDocument}
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
              onDeleteLoad={handleDeleteLoad}
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
                <FleetMap drivers={drivers} loads={loads} isVisible={activeTab === 'map' && !importPageVisible} />
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
            onDocument={(file, driverId) => { handleCloseCreateLoad(); return handleAiDocument(file, driverId); }}
            initialDriverId={selectedDriverForLoad?.id || null}
          />}
          {aiPreparedLoad && !importPageVisible && <QuickDriverModal
            key={aiPreparedLoad?.id || aiPreparedLoad?.brokerMessageId || 'closed'}
            isOpen
            onClose={() => setAiPreparedLoad(null)}
            loadData={aiPreparedLoad}
            drivers={drivers}
            initialDriverId={aiPreparedLoad.preferredDriverId}
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
