import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import KanbanBoard from './components/KanbanBoard';
import CreateLoadModal from './components/CreateLoadModal';
import QuickDriverModal from './components/QuickDriverModal';
import DocumentViewerModal from './components/DocumentViewerModal';
import FleetMap from './components/FleetMap';
import DriverRoster from './components/DriverRoster';
import AnalyticsOverview from './components/AnalyticsOverview';
import ProfileView from './components/ProfileView';
import DocumentsView from './components/DocumentsView';
import BrokerInbox from './components/BrokerInbox';
import PlatformAdminPanel from './components/PlatformAdminPanel';
import AuthView from './components/AuthView';
import { useAuth } from './hooks/useAuth';
import {
  createAndOfferLoad,
  createLoadFromBrokerProposal,
  prepareLoadFromDocument,
  reassignLoad,
  deleteUnassignedLoad,
  sendOffersForLoad,
  fetchWorkspace,
  createMember,
  fetchBrokerInboxUnreadCount,
  subscribeWorkspace,
} from './services/operationsService';
import { fetchUnreadChatCount, subscribeUnreadChats } from './services/chatService';

const tabs = ['kanban', 'drivers', 'map', 'analytics', 'docs', 'inbox', 'chat', 'profile'];
const DispatchChat = React.lazy(() => import('./components/DispatchChat'));

export default function App() {
  const auth = useAuth();
  return <Workspace key={auth.currentUser?.id || 'signed-out'} auth={auth} />;
}

function Workspace({ auth }) {
  const { currentUser, loading: authLoading, configured, authError, login, logout } = auth;
  const [activeTab, setActiveTab] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return tabs.includes(hash) ? hash : 'kanban';
  });
  const [loads, setLoads] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDriverForLoad, setSelectedDriverForLoad] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [chatDriverId, setChatDriverId] = useState(null);
  const [chatSelectionRequest, setChatSelectionRequest] = useState(0);
  const [aiPreparedLoad, setAiPreparedLoad] = useState(null);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [selectedLoadForDocs, setSelectedLoadForDocs] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '' });
  const [theme, setTheme] = useState(() => localStorage.getItem('apex_theme') || 'light');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadInboxCount, setUnreadInboxCount] = useState(0);

  const showToast = useCallback((message) => {
    setToast({ show: true, message });
    window.setTimeout(() => setToast((previous) => ({ ...previous, show: false })), 4500);
  }, []);

  const refreshWorkspace = useCallback(async ({ quiet = false } = {}) => {
    if (!currentUser || currentUser.roleCode === 'driver') return;
    if (!quiet) setWorkspaceLoading(true);
    try {
      const workspace = await fetchWorkspace();
      setLoads(workspace.loads);
      setDrivers(workspace.drivers);
      setWorkspaceError('');
    } catch (error) {
      setWorkspaceError(error.message || 'Ma\'lumotlarni yuklab bo\'lmadi.');
    } finally {
      if (!quiet) setWorkspaceLoading(false);
    }
  }, [currentUser]);

  const refreshUnreadChats = useCallback(async () => {
    if (!currentUser || currentUser.roleCode === 'driver') return;
    try {
      setUnreadChatCount(await fetchUnreadChatCount());
    } catch {
      // The page stays usable if the badge cannot refresh.
    }
  }, [currentUser]);

  const refreshUnreadInbox = useCallback(async () => {
    if (!currentUser || currentUser.roleCode === 'driver') return;
    try {
      setUnreadInboxCount(await fetchBrokerInboxUnreadCount());
    } catch {
      // The page stays usable if the badge cannot refresh.
    }
  }, [currentUser]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('apex_theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (tabs.includes(hash)) setActiveTab(hash);
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    if (!currentUser || currentUser.roleCode === 'driver') return undefined;
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize the authenticated workspace with remote data.
    refreshWorkspace();
    return subscribeWorkspace(() => refreshWorkspace({ quiet: true }));
  }, [currentUser, refreshWorkspace]);

  useEffect(() => {
    if (!currentUser || currentUser.roleCode === 'driver') return undefined;
    // oxlint-disable-next-line react/set-state-in-effect -- subscribe and load the external unread count.
    refreshUnreadChats();
    return subscribeUnreadChats(refreshUnreadChats);
  }, [currentUser, refreshUnreadChats]);

  useEffect(() => {
    if (!currentUser || currentUser.roleCode === 'driver') return undefined;
    // oxlint-disable-next-line react/set-state-in-effect -- poll the remote inbox badge.
    refreshUnreadInbox();
    const intervalId = window.setInterval(refreshUnreadInbox, 15_000);
    return () => window.clearInterval(intervalId);
  }, [currentUser, refreshUnreadInbox]);

  const handleSelectTab = (tab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  const handleCreateLoad = async (newLoad) => {
    setWorkspaceLoading(true);
    try {
      const result = await createAndOfferLoad(newLoad);
      const deliveredCount = result.offers.filter((offer) => offer.status === 'pending').length;
      const offlineCount = result.offers.filter((offer) => offer.status === 'missed_offline').length;
      await refreshWorkspace({ quiet: true });
      setIsCreateModalOpen(false);
      setSelectedDriverForLoad(null);
      showToast(
        `Yuk yaratildi. Yo‘l masofasi: ${result.route.loadedMiles} mil${result.route.attribution ? ` (${result.route.attribution})` : ''}. ${deliveredCount} ta online haydovchiga yetkazildi${offlineCount ? `, ${offlineCount} ta oflayn haydovchi o'tkazib yuborildi` : ''}.`,
      );
    } catch (error) {
      showToast(error.message || 'Yukni yaratib bo\'lmadi.');
      throw error;
    } finally {
      setWorkspaceLoading(false);
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

  const handleAiDocument = async (file) => {
    if (!file || aiProcessing) return;
    setAiProcessing(true);
    setWorkspaceLoading(true);
    try {
      const result = await prepareLoadFromDocument(file);
      await refreshWorkspace({ quiet: true });
      setAiPreparedLoad(result.preparedLoad);
      const warningCount = result.preparedLoad.missingFields?.length || 0;
      showToast(
        result.duplicate
          ? 'Bu hujjat oldin tahlil qilingan. Tayyor taklif ochildi.'
          : warningCount
            ? `AI yukni tayyorladi. ${warningCount} ta maydon aniqlashtirish talab qiladi.`
            : 'AI yukni tayyorladi. Endi haydovchini tanlang.',
      );
    } catch (error) {
      showToast(error.message || 'AI hujjatni tahlil qila olmadi.');
    } finally {
      setAiProcessing(false);
      setWorkspaceLoading(false);
    }
  };

  const handleDeleteLoad = async (load) => {
    setWorkspaceLoading(true);
    try {
      await deleteUnassignedLoad(load.id);
      setAiPreparedLoad((current) => current?.id === load.id ? null : current);
      setSelectedLoadForDocs((current) => current?.id === load.id ? null : current);
      await refreshWorkspace({ quiet: true });
      showToast(`${load.loadNumber} yuk o‘chirildi.`);
    } catch (error) {
      showToast(error.message || 'Yukni o‘chirib bo‘lmadi.');
      throw error;
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleSendAiOffer = async (driverIds) => {
    if (!aiPreparedLoad) return;
    setWorkspaceLoading(true);
    try {
      const preparedLoad = !aiPreparedLoad.id && aiPreparedLoad.brokerMessageId
        ? await createLoadFromBrokerProposal(aiPreparedLoad)
        : aiPreparedLoad;
      const isReassignment = ['assigned', 'in_progress'].includes(preparedLoad.lifecycleStatus);
      const dispatch = isReassignment
        ? { offers: [await reassignLoad(preparedLoad.id, driverIds[0])], route: null }
        : await sendOffersForLoad(
          preparedLoad.id,
          driverIds,
          preparedLoad.missingFields,
        );
      const offers = dispatch.offers;
      const deliveredCount = offers.filter((offer) => offer.status === 'pending').length;
      const offlineCount = offers.filter((offer) => offer.status === 'missed_offline').length;
      await refreshWorkspace({ quiet: true });
      setAiPreparedLoad(null);
      showToast(
        isReassignment
          ? deliveredCount
            ? 'Yuk yangi haydovchiga qayta tayinlash uchun yuborildi.'
            : 'Tanlangan haydovchi oflayn. Taklif o‘tkazib yuborildi.'
          : `Yo‘l masofasi: ${dispatch.route.loadedMiles} mil${dispatch.route.attribution ? ` (${dispatch.route.attribution})` : ''}. ${deliveredCount} ta online haydovchiga taklif yuborildi${offlineCount ? `, ${offlineCount} ta oflayn haydovchi o'tkazib yuborildi` : ''}.`,
      );
    } catch (error) {
      showToast(error.message || 'Taklifni yuborib bo\'lmadi.');
    } finally {
      setWorkspaceLoading(false);
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
        <span className="font-semibold">Sessiya tekshirilmoqda…</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthView
        onLogin={login}
        externalError={!configured ? 'Supabase sozlanmagan. .env.local faylini tekshiring.' : authError}
        theme={theme}
        toggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
      />
    );
  }

  if (currentUser.roleCode === 'driver') {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 text-center shadow-xl">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Driver mobil ilovasidan foydalaning</h1>
          <p className="text-sm text-zinc-500 mt-2">Web panel administrator va dispatcherlar uchun mo‘ljallangan.</p>
          <button onClick={logout} className="mt-6 px-5 py-2.5 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 font-bold">
            Hisobdan chiqish
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
        loadsCount={loads.length}
        driversCount={drivers.length}
        unreadChatCount={unreadChatCount}
        unreadInboxCount={unreadInboxCount}
        onDropFile={() => showToast('Broker fayllari Gmail/AI worker orqali avtomatik keladi.')}
        currentUser={currentUser}
        onLogout={logout}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {activeTab !== 'chat' && (
          <TopHeader
            activeTab={activeTab}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onOpenCreateModal={() => handleOpenCreateLoad()}
            activeLoadsCount={metrics.activeLoadsCount}
            totalRevenue={metrics.totalRevenue}
            avgRPM={metrics.avgRPM}
            theme={theme}
            toggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            onExitDriver={activeTab === 'drivers' && selectedDriverId ? () => setSelectedDriverId(null) : undefined}
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

        <main className={`workspace-main min-h-0 flex-1 relative ${activeTab === 'chat' ? 'workspace-main-chat' : 'overflow-y-auto p-5 space-y-4'}`}>
          {workspaceLoading && (
            <div className="absolute inset-0 z-30 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-[1px] flex items-center justify-center">
              <LoaderCircle className="w-7 h-7 animate-spin text-zinc-700 dark:text-zinc-300" />
            </div>
          )}
          {activeTab === 'kanban' && (
            <KanbanBoard
              loads={filteredLoads}
              drivers={drivers}
              onAdvanceStatus={() => showToast('Load statusini driver mobil ilovadan o‘zgartiradi.')}
              onOpenDocs={setSelectedLoadForDocs}
              onDeleteLoad={handleDeleteLoad}
              onDropOnOffer={handleAiDocument}
              isAiProcessing={aiProcessing}
            />
          )}
          {activeTab === 'map' && <FleetMap drivers={drivers} loads={loads} onSelectLoad={setSelectedLoadForDocs} />}
          {activeTab === 'drivers' && (
            <DriverRoster
              drivers={drivers}
              loads={loads}
              onAssignLoad={handleOpenCreateLoad}
              onOpenDocs={setSelectedLoadForDocs}
              onDeleteLoad={handleDeleteLoad}
              onDropOnOffer={handleAiDocument}
              isAiProcessing={aiProcessing}
              currentUser={currentUser}
              onUnreadChange={refreshUnreadChats}
              selectedDriverId={selectedDriverId}
              onSelectDriver={setSelectedDriverId}
              onOpenChat={(driver) => { setChatDriverId(driver.id); setChatSelectionRequest((value) => value + 1); handleSelectTab('chat'); }}
            />
          )}
          {activeTab === 'docs' && <DocumentsView loads={loads} drivers={drivers} onOpenDocs={setSelectedLoadForDocs} />}
          {activeTab === 'inbox' && (
            <BrokerInbox
              drivers={drivers}
              onUnreadChange={refreshUnreadInbox}
              onCreateLoad={(message) => setAiPreparedLoad({
                ...message.extraction.result,
                brokerMessageId: message.id,
              })}
            />
          )}
          {activeTab === 'analytics' && <AnalyticsOverview loads={loads} />}
          <div className={activeTab === 'chat' ? 'h-full min-h-0' : 'hidden'}>
            <React.Suspense fallback={<div className="dispatch-chat-workspace grid h-full place-items-center"><LoaderCircle className="h-7 w-7 animate-spin" /></div>}>
              <DispatchChat
                drivers={drivers}
                currentUser={currentUser}
                isVisible={activeTab === 'chat'}
                activeChatDriver={drivers.find((driver) => driver.id === chatDriverId)}
                selectionRequestKey={chatSelectionRequest}
                onUnreadChange={refreshUnreadChats}
              />
            </React.Suspense>
          </div>
          {activeTab === 'profile' && (
            currentUser.roleCode === 'super_admin' ? <PlatformAdminPanel onLogout={logout} /> : (
              <ProfileView
                drivers={drivers}
                loads={loads}
                onAddDriver={handleCreateMember}
                onDeleteDriver={() => showToast('Foydalanuvchi o‘chirilmaydi; admin uni suspended holatiga o‘tkazadi.')}
                currentUser={currentUser}
                onLogout={logout}
              />
            )
          )}
        </main>
      </div>

      {isCreateModalOpen && <CreateLoadModal
        key={selectedDriverForLoad?.id || 'all-drivers'}
        isOpen={isCreateModalOpen}
        onClose={handleCloseCreateLoad}
        drivers={drivers}
        onCreateLoad={handleCreateLoad}
        onDocument={(file) => { handleCloseCreateLoad(); return handleAiDocument(file); }}
        initialDriverId={selectedDriverForLoad?.id || null}
      />}
      <QuickDriverModal
        key={aiPreparedLoad?.id || aiPreparedLoad?.brokerMessageId || 'closed'}
        isOpen={Boolean(aiPreparedLoad)}
        onClose={() => setAiPreparedLoad(null)}
        loadData={aiPreparedLoad}
        drivers={drivers}
        onConfirm={handleSendAiOffer}
      />
      <DocumentViewerModal
        isOpen={Boolean(selectedLoadForDocs)}
        onClose={() => setSelectedLoadForDocs(null)}
        load={selectedLoadForDocs}
        onApproveAndInvoice={() => showToast('Hujjat warninglari ko‘rib chiqildi. AI loadni bloklamaydi.')}
      />
    </div>
  );
}
