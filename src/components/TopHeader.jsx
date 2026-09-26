import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, LayoutGrid, Search, Plus, Sun, Moon, UserRound, X } from 'lucide-react';

const titles = {
  kanban: 'Yuklar', drivers: 'Haydovchilar', map: 'Xarita',
  docs: 'Hujjatlar', inbox: 'Broker Inbox', chat: 'Chat', profile: 'Profil',
};

export default function TopHeader({
  activeTab,
  searchQuery,
  setSearchQuery,
  searchResults = [],
  onSelectSearchResult,
  onOpenCreateModal,
  theme,
  toggleTheme,
  onExitDriver,
}) {
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const mobileSearchTriggerRef = useRef(null);
  const mobileSearchCloseRef = useRef(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const hasQuery = Boolean(searchQuery.trim());
  const safeActiveResultIndex = Math.min(activeResultIndex, Math.max(0, searchResults.length - 1));

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!searchRef.current?.contains(event.target)) setIsSearchOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const closeMobileSearch = (restoreFocus = true) => {
    setIsSearchOpen(false);
    setIsMobileSearchOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => mobileSearchTriggerRef.current?.focus());
  };

  const selectResult = (result) => {
    onSelectSearchResult?.(result);
    if (isMobileSearchOpen) closeMobileSearch();
    else setIsSearchOpen(false);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (isMobileSearchOpen) closeMobileSearch();
      else setIsSearchOpen(false);
      return;
    }
    if (!searchResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsSearchOpen(true);
      setActiveResultIndex((index) => (index + 1) % searchResults.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsSearchOpen(true);
      setActiveResultIndex((index) => (index - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === 'Enter' && isSearchOpen) {
      event.preventDefault();
      selectResult(searchResults[safeActiveResultIndex]);
    }
  };

  const resultIcon = (type) => {
    if (type === 'driver') return UserRound;
    if (type === 'load') return FileText;
    return LayoutGrid;
  };

  const handleSearchSurfaceKeyDown = (event) => {
    if (!isMobileSearchOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobileSearch();
      return;
    }
    if (event.key !== 'Tab') return;

    const firstElement = searchInputRef.current;
    const lastElement = mobileSearchCloseRef.current;
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  };

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
        <div
          ref={searchRef}
          role={isMobileSearchOpen ? 'dialog' : undefined}
          aria-modal={isMobileSearchOpen ? 'true' : undefined}
          aria-label={isMobileSearchOpen ? 'Umumiy qidiruv' : undefined}
          className={`workspace-search-wrap ${isMobileSearchOpen ? 'workspace-search-wrap-mobile-open' : ''}`}
          onKeyDown={handleSearchSurfaceKeyDown}
        >
          <button
            ref={mobileSearchTriggerRef}
            type="button"
            className="workspace-search-mobile-trigger"
            aria-label="Qidiruvni ochish"
            onClick={() => {
              setIsMobileSearchOpen(true);
              setIsSearchOpen(true);
              window.requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          >
            <Search size={18} aria-hidden="true" />
          </button>
          <label className="workspace-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              role="combobox"
              aria-label="Umumiy qidiruv"
              aria-autocomplete="list"
              aria-expanded={hasQuery && isSearchOpen}
              aria-controls="workspace-search-results"
              aria-activedescendant={hasQuery && isSearchOpen && searchResults[safeActiveResultIndex]
                ? `workspace-search-result-${safeActiveResultIndex}`
                : undefined}
              placeholder="Qidirish..."
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setActiveResultIndex(0);
                setIsSearchOpen(true);
              }}
            />
          </label>
          <button
            ref={mobileSearchCloseRef}
            type="button"
            className="workspace-search-mobile-close"
            aria-label="Qidiruvni yopish"
            onClick={() => closeMobileSearch()}
          >
            <X size={18} aria-hidden="true" />
          </button>
          {hasQuery && isSearchOpen && (
            <div id="workspace-search-results" role="listbox" aria-label="Qidiruv natijalari" className="workspace-search-results">
              {searchResults.length ? searchResults.map((result, index) => {
                const ResultIcon = resultIcon(result.type);
                return (
                  <button
                    key={result.id}
                    id={`workspace-search-result-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === safeActiveResultIndex}
                    className={`workspace-search-result ${index === safeActiveResultIndex ? 'workspace-search-result-active' : ''}`}
                    onMouseEnter={() => setActiveResultIndex(index)}
                    onClick={() => selectResult(result)}
                  >
                    <span className="workspace-search-result-icon"><ResultIcon size={17} aria-hidden="true" /></span>
                    <span className="workspace-search-result-copy">
                      <strong>{result.title}</strong>
                      <small>{result.subtitle}</small>
                    </span>
                    <span className="workspace-search-result-kind">{result.category}</span>
                  </button>
                );
              }) : (
                <p className="workspace-search-empty">“{searchQuery.trim()}” bo‘yicha natija topilmadi</p>
              )}
            </div>
          )}
        </div>
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
