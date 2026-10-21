import './accessibility.css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { roleLabel } from '../i18n/labels';
import {
  Wallet,
  Truck,
  ChartNoAxesCombined,
  MapPin,
  Users,
  MessageSquare,
  Inbox,
  User,
  ChevronLeft,
  ChevronRight,
  LogOut
} from 'lucide-react';

export default function Sidebar({
  activeTab,
  setActiveTab,
  onPrefetch,
  unreadChatCount,
  unreadInboxCount,
  currentUser,
  onLogout
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const navigation = [
    {
      id: 'drivers',
      label: t('nav.drivers'),
      icon: Users,
    },
    {
      id: 'map',
      label: t('nav.map'),
      icon: MapPin
    },
    { id: 'arrivals', label: t('arrival.nav'), icon: Truck },
    { id: 'accounting', label: t('accounting.title'), icon: Wallet },
    { id: 'analytics', label: t('analytics.title'), icon: ChartNoAxesCombined },
    {
      id: 'inbox',
      label: t('nav.inbox'),
      icon: Inbox,
      badge: unreadInboxCount || null,
      badgeTone: 'alert',
    },
    {
      id: 'chat',
      label: t('nav.chat'),
      icon: MessageSquare,
      badge: unreadChatCount || null,
      badgeTone: 'alert',
    },
    {
      id: 'profile',
      label: t('nav.profile'),
      icon: User
    }
  ];
  const visibleNavigation = currentUser?.roleCode === 'super_admin'
    ? navigation.filter((item) => item.id === 'profile')
    : navigation;

  const profileCard = <div className="sidebar-footer p-3 border-t border-zinc-200 dark:border-zinc-800">
    <div
      className={`sidebar-account-card ${activeTab === 'profile' ? 'is-active' : ''} p-2 rounded-2xl border transition-colors flex items-center ${
        collapsed ? 'justify-center' : 'space-x-2.5'
      } ${
        activeTab === 'profile'
          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 shadow-2xs'
          : 'border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
      }`}
    >
      <button type="button" className="sidebar-profile-trigger flex min-w-0 flex-1 items-center gap-2.5 rounded-lg"
        aria-label={t('profile.overview')} title={t('profile.overview')} onClick={() => setActiveTab('profile')}>
      <div className="sidebar-account-avatar w-8 h-8 rounded-xl bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-mono text-xs font-black flex-shrink-0 shadow-xs">
        {currentUser?.avatarInitial || currentUser?.name?.charAt(0) || 'D'}
      </div>

      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {currentUser?.name || t('roles.dispatcher')}
          </p>
          <p className="text-[11px] text-zinc-500 font-medium truncate flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            <span className="truncate">{roleLabel(t, currentUser?.roleCode || currentUser?.role)}</span>
          </p>
        </div>
      )}

      </button>
      {onLogout && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t('nav.logoutConfirm'))) {
              onLogout();
            }
          }}
          className="sidebar-logout p-1.5 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
          aria-label={t('nav.logout')} title={t('nav.logout')}
        >
          <LogOut className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>;

  function navigationButton(item) {
    const Icon = item.icon;
    const isActive = activeTab === item.id;

    return <button
      key={item.id}
      type="button"
      aria-label={item.badgeTone === 'alert' && item.badge ? t('nav.unreadCount', { label: item.label, count: item.badge }) : item.label}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => setActiveTab(item.id)}
      onPointerEnter={() => onPrefetch?.(item.id)}
      onFocus={() => onPrefetch?.(item.id)}
      className={`nav-item w-full flex items-center rounded-xl text-base transition-colors relative ${
        collapsed ? 'justify-center h-12 px-0' : 'justify-between px-3.5 h-11'
      } ${
        isActive
          ? 'nav-item-active font-semibold'
          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium'
      }`}
      title={collapsed ? item.label : undefined}
    >
      <div className="flex items-center space-x-3 min-w-0">
        <Icon className="w-5 h-5 flex-shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </div>
      {Boolean(item.badge) && <span className={`sidebar-nav-badge font-mono font-bold rounded-md ${collapsed ? 'absolute right-1 top-1 min-w-4 px-1 text-[10px]' : 'px-2 py-0.5 text-xs'} ${
        item.badgeTone === 'alert'
          ? 'sidebar-alert-badge bg-red-500 text-white'
          : 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
      }`}>{item.badge}</span>}
    </button>;
  }

  const chatItem = visibleNavigation.find(item => item.id === 'chat');

  return (
    <aside
      className={`workspace-sidebar bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col justify-between select-none ${
        collapsed ? 'is-collapsed w-20' : 'w-56'
      }`}
    >
      <div>
        {/* Workspace Brand Header */}
        <div className="sidebar-brand h-16 flex items-center justify-between px-5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center overflow-hidden">
            {!collapsed && (
              <span className="font-bold text-lg text-zinc-900 dark:text-zinc-100 tracking-tight">
                T Fleets
              </span>
            )}
          </div>

          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md transition-colors hidden lg:block"
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation List */}
        <nav aria-label={t('nav.mainMenu')} className="sidebar-nav p-3 space-y-1.5">
          {visibleNavigation.filter(item => item.id !== 'chat').map(navigationButton)}
        </nav>
      </div>
      <div className="sidebar-bottom">
        {chatItem && <nav aria-label={chatItem.label} className="sidebar-nav sidebar-bottom-chat p-3">{navigationButton(chatItem)}</nav>}
        {profileCard}
      </div>
    </aside>
  );
}
