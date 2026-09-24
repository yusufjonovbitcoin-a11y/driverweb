import React, { useState } from 'react';
import { 
  Truck, 
  LayoutDashboard, 
  MapPin, 
  Users, 
  FileText, 
  Inbox,
  BarChart3, 
  User,
  ChevronLeft, 
  ChevronRight,
  LogOut
} from 'lucide-react';

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  loadsCount, 
  driversCount, 
  onDropFile,
  currentUser,
  onLogout
}) {
  const [collapsed, setCollapsed] = useState(false);

  const navigation = [
    { 
      id: 'kanban', 
      label: 'Yuklar', 
      icon: LayoutDashboard, 
      badge: loadsCount 
    },
    { 
      id: 'drivers', 
      label: 'Haydovchilar', 
      icon: Users, 
      badge: driversCount 
    },
    { 
      id: 'map', 
      label: 'Xarita', 
      icon: MapPin 
    },
    { 
      id: 'docs', 
      label: 'Hujjatlar', 
      icon: FileText 
    },
    {
      id: 'inbox',
      label: 'Broker Inbox',
      icon: Inbox,
    },
    { 
      id: 'analytics', 
      label: 'Moliya', 
      icon: BarChart3 
    },
    {
      id: 'profile',
      label: 'Profil',
      icon: User
    }
  ];

  return (
    <aside 
      className={`bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col justify-between transition-all duration-150 select-none ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div>
        {/* Workspace Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950 flex-shrink-0 shadow-sm">
              <Truck className="w-5 h-5" />
            </div>

            {!collapsed && (
              <span className="font-bold text-lg text-zinc-900 dark:text-zinc-100 tracking-tight">
                ApexHaul
              </span>
            )}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md transition-colors hidden lg:block"
            title={collapsed ? 'Kengaytirish' : 'Yig\'ish'}
          >
            {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation List */}
        <nav className="p-3 space-y-1.5">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                onDragOver={(e) => {
                  if (item.id === 'kanban') {
                    e.preventDefault();
                  }
                }}
                onDrop={(e) => {
                  if (item.id === 'kanban') {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file && onDropFile) {
                      onDropFile(file);
                    }
                  }
                }}
                className={`w-full flex items-center rounded-xl text-base transition-colors relative ${
                  collapsed ? 'justify-center h-12 px-0' : 'justify-between px-3.5 h-11'
                } ${
                  isActive
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </div>

                {!collapsed && item.badge && (
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-zinc-200/80 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Profile Section */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
        <div 
          onClick={() => setActiveTab('profile')}
          className={`p-2 rounded-2xl border transition-all cursor-pointer flex items-center ${
            collapsed ? 'justify-center' : 'space-x-2.5'
          } ${
            activeTab === 'profile'
              ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 shadow-2xs'
              : 'border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
          }`}
          title="Dispetcher profili va drayverlar"
        >
          <div className="w-8 h-8 rounded-xl bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-mono text-xs font-black flex-shrink-0 shadow-xs">
            {currentUser?.avatarInitial || currentUser?.name?.charAt(0) || 'D'}
          </div>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {currentUser?.name || 'Dispecher'}
              </p>
              <p className="text-[11px] text-emerald-500 font-medium truncate flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                <span className="truncate">{currentUser?.role || 'Onlayn (Profil)'}</span>
              </p>
            </div>
          )}

          {!collapsed && onLogout && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Tizimdan chiqishni xohlaysizmi?')) {
                  onLogout();
                }
              }}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
              title="Hisobdan chiqish"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

    </aside>
  );
}
