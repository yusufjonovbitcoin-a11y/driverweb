import React from 'react';
import { 
  Truck, 
  PlusCircle, 
  MapPin, 
  LayoutDashboard, 
  Users, 
  FileText, 
  MessageSquare, 
  DollarSign, 
  Activity, 
  Radio
} from 'lucide-react';

export default function Navbar({ 
  activeTab, 
  setActiveTab, 
  onOpenCreateModal, 
  loadsCount, 
  driversCount, 
  activeLoadsCount,
  unreadMessagesCount
}) {
  const tabs = [
    { id: 'kanban', label: 'Yuklar doskasi', icon: LayoutDashboard, badge: loadsCount },
    { id: 'map', label: 'Jonli Xarita', icon: MapPin, pulse: true },
    { id: 'drivers', label: 'Haydovchilar & HOS', icon: Users, badge: `${driversCount} aktiv` },
    { id: 'docs', label: 'Hujjatlar & Invoys', icon: FileText },
    { id: 'chat', label: 'Drayver Chat', icon: MessageSquare, badge: unreadMessagesCount > 0 ? unreadMessagesCount : null },
  ];

  return (
    <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40">
      {/* Top bar with Branding & Primary KPIs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Company */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Truck className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-white">ApexHaul</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  DISPATCH TMS
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-xs text-emerald-400">
                <Radio className="w-3 h-3 animate-pulse" />
                <span>Jonli aloqa (DriverApp v2.4 ulangan)</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Strip */}
          <div className="hidden lg:flex items-center space-x-6 bg-slate-950/60 border border-slate-800/80 rounded-xl px-4 py-2">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <div className="text-xs">
                <span className="text-slate-400">Faol reyslar: </span>
                <span className="font-semibold text-white">{activeLoadsCount} ta</span>
              </div>
            </div>

            <div className="w-px h-6 bg-slate-800" />

            <div className="flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <div className="text-xs">
                <span className="text-slate-400">Haftalik daromad: </span>
                <span className="font-semibold text-emerald-400">$24,850</span>
              </div>
            </div>

            <div className="w-px h-6 bg-slate-800" />

            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-amber-400">RPM:</span>
              <div className="text-xs">
                <span className="text-slate-400">O'rtacha stavka: </span>
                <span className="font-semibold text-amber-300">$3.05 / mil</span>
              </div>
            </div>
          </div>

          {/* Action Button: Post Load */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onOpenCreateModal}
              className="group relative inline-flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg shadow-blue-600/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-blue-400/30"
            >
              <PlusCircle className="w-5 h-5 text-blue-200 group-hover:rotate-90 transition-transform duration-300" />
              <span>Yangi yuk berish</span>
              <span className="bg-blue-400/30 text-blue-100 text-xs px-1.5 py-0.5 rounded font-mono">
                Rate Con
              </span>
            </button>
          </div>

        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-slate-800/60">
        <nav className="flex space-x-1 sm:space-x-4 py-2 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.pulse && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                )}
                {tab.badge && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                    isActive ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
