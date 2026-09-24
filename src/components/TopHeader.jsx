import React from 'react';
import { 
  Search, 
  Plus, 
  Sun, 
  Moon 
} from 'lucide-react';

export default function TopHeader({ 
  activeTab, 
  searchQuery, 
  setSearchQuery, 
  onOpenCreateModal, 
  theme,
  toggleTheme
}) {
  const getTabTitle = () => {
    switch (activeTab) {
      case 'kanban': return 'Yuklar';
      case 'map': return 'Xarita';
      case 'drivers': return 'Haydovchilar';
      case 'docs': return 'Hujjatlar';
      case 'inbox': return 'Broker Inbox';
      case 'analytics': return 'Moliya';
      case 'profile': return 'Profil va Haydovchilar';
      default: return 'Boshqaruv';
    }
  };

  return (
    <header className="h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-6 flex items-center justify-between sticky top-0 z-20 transition-colors">
      
      {/* Title */}
      <h1 className="text-lg lg:text-xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight">
        {getTabTitle()}
      </h1>

      {/* Global Clean Search Bar */}
      <div className="flex-1 max-w-md mx-8 hidden md:block">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Yuk yoki drayver qidirish..."
            className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm lg:text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center space-x-3.5">
        {/* Theme Toggle Button (Dark / White Mode) */}
        <button
          onClick={toggleTheme}
          className="p-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-zinc-100 dark:bg-zinc-900 rounded-xl transition-colors"
          title={theme === 'dark' ? 'Oq rejim' : 'Qora rejim'}
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-amber-400" />
          ) : (
            <Moon className="w-5 h-5 text-zinc-700" />
          )}
        </button>

        {/* Action Button */}
        <button
          onClick={onOpenCreateModal}
          className="inline-flex items-center space-x-2 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 text-sm lg:text-base font-bold px-4 py-2 rounded-xl transition-colors shadow-xs"
        >
          <Plus className="w-5 h-5" />
          <span>Yuk berish</span>
        </button>
      </div>

    </header>
  );
}
