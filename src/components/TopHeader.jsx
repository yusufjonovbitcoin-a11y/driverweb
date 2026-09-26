import React from 'react';
import { ArrowLeft, Search, Plus, Sun, Moon } from 'lucide-react';

const titles = {
  kanban: 'Yuklar', drivers: 'Haydovchilar', map: 'Xarita',
  docs: 'Hujjatlar', inbox: 'Broker Inbox', chat: 'Chat',
  analytics: 'Moliya', profile: 'Profil',
};

export default function TopHeader({
  activeTab, searchQuery, setSearchQuery, onOpenCreateModal, theme, toggleTheme, onExitDriver,
}) {
  return (
    <header className="workspace-header">
      <div className="header-breadcrumb">
        {onExitDriver && (
          <button
            type="button"
            onClick={onExitDriver}
            className="driver-header-exit"
            aria-label="Haydovchilar ro‘yxatiga qaytish"
            title="Haydovchilar ro‘yxatiga qaytish"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        )}
        <h1>{titles[activeTab] || 'Boshqaruv'}</h1>
      </div>
      <div className="header-actions">
        <label className="workspace-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Yuk yoki haydovchi qidirish"
            placeholder="Qidirish..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={toggleTheme}
          className="quiet-icon-button"
          aria-label={theme === 'dark' ? 'Oq rejim' : 'Qora rejim'}
          title={theme === 'dark' ? 'Oq rejim' : 'Qora rejim'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button type="button" onClick={onOpenCreateModal} className="primary-button">
          <Plus size={17} aria-hidden="true" />
          <span>Yuk berish</span>
        </button>
      </div>
    </header>
  );
}
