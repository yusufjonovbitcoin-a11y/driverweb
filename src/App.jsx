import React, { useState, useEffect } from 'react';
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
import AuthView from './components/AuthView';
import { INITIAL_LOADS, DRIVERS } from './data/mockData';
import { X } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    return ["kanban", "drivers", "map", "analytics", "docs", "profile"].includes(hash) ? hash : "kanban";
  });

  const handleSelectTab = (tab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.location.hash = tab;
    }
  };

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (["kanban", "drivers", "map", "analytics", "docs", "profile"].includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);
  // Authentication State
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('apex_user_logged_out') === 'true') {
      return null;
    }
    const saved = typeof window !== 'undefined' ? localStorage.getItem('apex_user') : null;
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      name: 'Dilshod Rahimov',
      email: 'dispatch@apexhaul.com',
      role: 'Bosh Dispecher (Admin)',
      company: 'ApexHaul Logistics LLC',
      mcNumber: 'MC-984210',
      dotNumber: 'USDOT 3891452',
      phone: '+1 (312) 555-0100',
      avatarInitial: 'D'
    };
  });

  const handleLogin = (userData) => {
    setCurrentUser(userData);
    if (typeof window !== 'undefined') {
      localStorage.setItem('apex_user', JSON.stringify(userData));
      localStorage.removeItem('apex_user_logged_out');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('apex_user');
      localStorage.setItem('apex_user_logged_out', 'true');
    }
  };

  const [loads, setLoads] = useState(INITIAL_LOADS);
  const [drivers, setDrivers] = useState(DRIVERS);
  const [searchQuery, setSearchQuery] = useState('');

  // Dark / Light (White) Mode Management
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('apex_theme') || 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('apex_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Modals & Active state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [quickLoadData, setQuickLoadData] = useState(null);
  const [isQuickDriverModalOpen, setIsQuickDriverModalOpen] = useState(false);
  const [selectedLoadForDocs, setSelectedLoadForDocs] = useState(null);

  // Toast notification
  const [toast, setToast] = useState({
    show: false,
    message: 'ApexHaul TMS platformasi tayyor. Oq yoki qora rejimda qulay foydalaning.'
  });

  const showToast = (message) => {
    setToast({ show: true, message });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  // Search filter
  const filteredLoads = loads.filter((load) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const driver = drivers.find(d => d.id === load.driverId);
    return (
      load.loadNumber.toLowerCase().includes(q) ||
      load.broker.toLowerCase().includes(q) ||
      load.origin.city.toLowerCase().includes(q) ||
      load.origin.state.toLowerCase().includes(q) ||
      load.destination.city.toLowerCase().includes(q) ||
      load.destination.state.toLowerCase().includes(q) ||
      (driver && driver.name.toLowerCase().includes(q))
    );
  });

  // Drop on 'Takliflar' column -> AI parses and opens driver picker
  const handleDropOnOffer = (file) => {
    const fileUrl = URL.createObjectURL(file);

    const sampleRoutes = [
      { from: 'Chicago, IL', to: 'Dallas, TX', miles: 925, rate: 3850, equip: "53' Reefer (-18°C)" },
      { from: 'Atlanta, GA', to: 'Detroit, MI', miles: 710, rate: 2450, equip: "53' Dry Van" },
      { from: 'Seattle, WA', to: 'Denver, CO', miles: 1420, rate: 4200, equip: "53' Reefer (+4°C)" },
      { from: 'Los Angeles, CA', to: 'Phoenix, AZ', miles: 375, rate: 1650, equip: "53' Dry Van" }
    ];
    const pick = sampleRoutes[Math.floor(Math.random() * sampleRoutes.length)];
    const [origCity, origState] = pick.from.split(', ');
    const [dstCity, dstState] = pick.to.split(', ');

    const preparedLoad = {
      id: `load-${Date.now().toString().slice(-5)}`,
      loadNumber: `#LD-${Math.floor(10000 + Math.random() * 90000)}`,
      status: 'OFFER',
      broker: 'C.H. Robinson (AI)',
      brokerContact: 'Dispatch Desk',
      brokerPhone: '+1 (800) 555-0199',
      rate: pick.rate,
      distanceMiles: pick.miles,
      ratePerMile: Number((pick.rate / pick.miles).toFixed(2)),
      origin: {
        city: origCity,
        state: origState,
        facility: 'Origin Distribution Hub',
        address: `${origCity}, ${origState}`,
        date: new Date().toISOString().split('T')[0],
        time: '08:00 - 10:00',
        lat: 41.8781,
        lng: -87.6298
      },
      destination: {
        city: dstCity,
        state: dstState,
        facility: 'Receiving Depot',
        address: `${dstCity}, ${dstState}`,
        date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
        time: '14:00 - 16:00',
        lat: 32.7767,
        lng: -96.7970
      },
      commodity: 'Oziq-ovqat / Umumiy yuk',
      weightLbs: 41200,
      equipment: pick.equip,
      temperature: pick.equip.includes('Reefer') ? '-18°C' : 'N/A',
      pallets: 24,
      documents: {
        rateCon: fileUrl,
        shipperBol: null,
        receiverPod: null
      },
      fileName: file.name
    };

    setQuickLoadData(preparedLoad);
    setIsQuickDriverModalOpen(true);
  };

  const handleConfirmQuickDispatch = (selectedDriverIds) => {
    if (!quickLoadData) return;

    const finalLoad = {
      ...quickLoadData,
      driverId: selectedDriverIds[0],
      targetDriverIds: selectedDriverIds,
      dispatchedAt: 'Hozirgina'
    };

    setLoads(prev => [finalLoad, ...prev]);
    setIsQuickDriverModalOpen(false);
    setQuickLoadData(null);

    const countText = selectedDriverIds.length > 1 ? `${selectedDriverIds.length} ta haydovchiga` : 'drayverga';
    showToast(`Yuk (${finalLoad.loadNumber}) AI tomonidan tayyorlandi va ${countText} taklif yuborildi.`);

    setTimeout(() => {
      setLoads(prev => prev.map(l => {
        if (l.id === finalLoad.id) {
          return {
            ...l,
            status: 'ASSIGNED',
            dispatchedAt: 'Qabul qilindi'
          };
        }
        return l;
      }));
      const assignedDriver = drivers.find(d => d.id === selectedDriverIds[0]);
      showToast(`${assignedDriver?.name || 'Drayver'} yukni (${finalLoad.loadNumber}) qabul qildi.`);
    }, 3500);
  };

  // 1. Create Load & Dispatch
  const handleCreateLoad = (newLoad) => {
    setLoads(prev => [newLoad, ...prev]);
    showToast(`Yuk (${newLoad.loadNumber}) drayverga yuborildi. Qabul kutilmoqda.`);

    // Simulated Driver Acceptance
    setTimeout(() => {
      setLoads(prev => prev.map(l => {
        if (l.id === newLoad.id) {
          return {
            ...l,
            status: 'ASSIGNED',
            dispatchedAt: 'Qabul qilindi'
          };
        }
        return l;
      }));

      const assignedDriver = drivers.find(d => d.id === newLoad.driverId);
      showToast(`${assignedDriver?.name || 'Drayver'} yukni (${newLoad.loadNumber}) qabul qildi.`);
    }, 3500);
  };

  // 2. Advance Status
  const handleAdvanceStatus = (loadId, newStatus) => {
    setLoads(prev => prev.map(l => {
      if (l.id === loadId) {
        let updatedDocs = { ...l.documents };

        if (newStatus === 'IN_TRANSIT' && !updatedDocs.shipperBol) {
          updatedDocs.shipperBol = 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=700&auto=format&fit=crop&q=80';
        }
        if (newStatus === 'DELIVERED' && !updatedDocs.receiverPod) {
          updatedDocs.receiverPod = 'https://images.unsplash.com/photo-1618042164219-62c820f10723?w=700&auto=format&fit=crop&q=80';
        }

        return {
          ...l,
          status: newStatus,
          documents: updatedDocs
        };
      }
      return l;
    }));

    if (newStatus === 'ASSIGNED') {
      showToast('Yuk holati: Tayinlangan');
    } else if (newStatus === 'IN_TRANSIT') {
      showToast('Yuk holati: Tranzitda (BOL biriktirildi)');
    } else if (newStatus === 'DELIVERED') {
      showToast('Yuk holati: Yetkazildi (POD biriktirildi)');
    }
  };

  // 3. Approve and Invoice
  const handleApproveAndInvoice = (loadId) => {
    setLoads(prev => prev.map(l => {
      if (l.id === loadId) {
        return { ...l, status: 'COMPLETED' };
      }
      return l;
    }));
    showToast('Hujjatlar tasdiqlandi. Hisob-faktura yuborildi.');
  };

  // Navigation handlers

  const handleAddDriver = (newDriverData) => {
    const newDriver = {
      id: 'd' + Date.now(),
      ...newDriverData
    };
    setDrivers(prev => [newDriver, ...prev]);
  };

  const handleDeleteDriver = (driverId) => {
    setDrivers(prev => prev.filter(d => d.id !== driverId));
  };

  const handleAssignLoadFromRoster = (driver) => {
    setIsCreateModalOpen(true);
  };

  const activeLoadsCount = loads.filter(l => l.status !== 'COMPLETED').length;
  const totalRevenue = loads.reduce((acc, curr) => acc + (curr.rate || 0), 0);
  const totalMiles = loads.reduce((acc, curr) => acc + (curr.distanceMiles || 0), 0);
  const avgRPM = totalMiles > 0 ? (totalRevenue / totalMiles).toFixed(2) : '3.05';

    // If not authenticated, render AuthView
  if (!currentUser) {
    return (
      <AuthView
        onLogin={handleLogin}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    );
  }

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans selection:bg-zinc-200 dark:selection:bg-zinc-700 selection:text-zinc-900 dark:selection:text-white transition-colors duration-150">
      
      {/* 1. Left Enterprise Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        loadsCount={loads.length}
        driversCount={drivers.length}
        onDropFile={handleDropOnOffer}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* 2. Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        
        {/* Top Header */}
        <TopHeader
          activeTab={activeTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
          activeLoadsCount={activeLoadsCount}
          totalRevenue={totalRevenue}
          avgRPM={avgRPM}
          theme={theme}
          toggleTheme={toggleTheme}
        />

        {/* Discreet Toast Bar */}
        {toast.show && (
          <div className="px-5 pt-2.5 animate-in fade-in duration-150">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300 shadow-xs">
              <div className="flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                <span>{toast.message}</span>
              </div>
              <button
                onClick={() => setToast(prev => ({ ...prev, show: false }))}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Content View */}
        <main className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'kanban' && (
            <KanbanBoard
              loads={filteredLoads}
              drivers={drivers}
              onAdvanceStatus={handleAdvanceStatus}
              onOpenDocs={(load) => setSelectedLoadForDocs(load)}
              onDropOnOffer={handleDropOnOffer}
            />
          )}

          {activeTab === 'map' && (
            <FleetMap
              drivers={drivers}
              loads={loads}
              onSelectLoad={(load) => setSelectedLoadForDocs(load)}
            />
          )}

          {activeTab === 'drivers' && (
            <DriverRoster
              drivers={drivers}
              loads={loads}
              onAssignLoad={handleAssignLoadFromRoster}
              onAddDriver={handleAddDriver}
            />
          )}

          {activeTab === 'docs' && (
            <DocumentsView
              loads={loads}
              drivers={drivers}
              onOpenDocs={(load) => setSelectedLoadForDocs(load)}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsOverview loads={loads} />
          )}

          {activeTab === 'profile' && (
            <ProfileView
              drivers={drivers}
              loads={loads}
              onAddDriver={handleAddDriver}
              onDeleteDriver={handleDeleteDriver}
              currentUser={currentUser}
              onLogout={handleLogout}
            />
          )}
        </main>

      </div>

      {/* Modals */}
      <QuickDriverModal
        isOpen={isQuickDriverModalOpen}
        onClose={() => {
          setIsQuickDriverModalOpen(false);
          setQuickLoadData(null);
        }}
        loadData={quickLoadData}
        drivers={drivers}
        onConfirm={handleConfirmQuickDispatch}
      />

      <CreateLoadModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        drivers={drivers}
        onCreateLoad={handleCreateLoad}
      />

      <DocumentViewerModal
        isOpen={!!selectedLoadForDocs}
        onClose={() => setSelectedLoadForDocs(null)}
        load={selectedLoadForDocs}
        onApproveAndInvoice={handleApproveAndInvoice}
      />

    </div>
  );
}
