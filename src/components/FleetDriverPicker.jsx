import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Truck, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeSearchText } from '../utils/globalSearch.js';
import './fleet-driver-picker.css';

export default function FleetDriverPicker({ drivers, selectedDriver, onSelect, isVisible = true }) {
  const { t } = useTranslation();
  const id = useId();
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const supported = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  const filtered = drivers.filter(driver => {
    const text = normalizeSearchText([driver.name, driver.driverNumber, driver.truck].filter(Boolean).join(' '));
    return tokens.every(token => text.includes(token));
  });
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1));
  const name = driver => driver?.name || t('documentImportSelection.unnamedDriver');
  const metadata = driver => [driver?.driverNumber, driver?.truck].filter(Boolean).join(' · ') || '—';

  const positionPopup = () => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || document.documentElement.clientWidth);
    const bottom = top + (viewport?.height || window.innerHeight);
    const width = Math.min(360, right - left - 24);
    const anchorTop = Math.max(top + 12, Math.min(rect.top, bottom - 12));
    const anchorBottom = Math.max(top + 12, Math.min(rect.bottom, bottom - 12));
    const above = rect.top - top > bottom - rect.bottom;
    Object.assign(popup.style, {
      width: `${width}px`, left: `${Math.max(left + 12, Math.min(rect.left, right - width - 12))}px`,
      top: above ? 'auto' : `${anchorBottom + 8}px`,
      bottom: above ? `${window.innerHeight - anchorTop + 8}px` : 'auto',
      maxHeight: `${Math.max(0, Math.min(420, (above ? anchorTop - top : bottom - anchorBottom) - 20))}px`,
    });
  };

  const close = (restoreFocus = false) => {
    popupRef.current?.hidePopover();
    if (restoreFocus) triggerRef.current?.focus();
  };
  const select = driver => { onSelect(driver.id); close(true); };
  const focusOption = index => {
    const buttons = listRef.current?.querySelectorAll('button');
    if (!buttons?.length) return;
    const next = (index + buttons.length) % buttons.length;
    setActiveIndex(next);
    buttons[next].focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const reposition = event => { if (!(event?.target instanceof Node && popupRef.current?.contains(event.target))) positionPopup(); };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    const observer = new ResizeObserver(positionPopup);
    if (triggerRef.current) observer.observe(triggerRef.current);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      observer.disconnect();
    };
  }, [open]);
  useEffect(() => { if (supported && (!isVisible || !drivers.length)) popupRef.current?.hidePopover(); }, [isVisible, drivers.length, supported]);

  if (!supported) return <label className="fleet-driver-fallback"><span className="sr-only">{t('drivers.driver')}</span>
    <select value={selectedDriver?.id || ''} onChange={event => onSelect(event.target.value)} disabled={!drivers.length}>
      {!drivers.length && <option value="">{t('drivers.noDrivers')}</option>}
      {drivers.map(driver => <option key={driver.id} value={driver.id}>{name(driver)}</option>)}
    </select>
  </label>;

  return <>
    <button ref={triggerRef} type="button" className="fleet-driver-trigger" disabled={!drivers.length}
      popoverTarget={id} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      aria-label={`${t('drivers.driver')}: ${selectedDriver ? name(selectedDriver) : t('drivers.noDrivers')}`}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); popupRef.current?.showPopover(); } }}>
      <DriverAvatar driver={selectedDriver} />
      <span className="fleet-driver-trigger-copy"><strong>{selectedDriver ? name(selectedDriver) : t('drivers.noDrivers')}</strong>
        <span className="fleet-driver-trigger-meta"><span title={metadata(selectedDriver)}>{metadata(selectedDriver)}</span>{selectedDriver && <DriverPresence driver={selectedDriver} />}</span>
      </span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <section ref={popupRef} id={id} popover="auto" role="dialog" aria-label={t('documentImportSelection.title')} className="fleet-driver-popover"
      onBeforeToggle={event => { if (event.newState === 'open') { positionPopup(); setQuery(''); setActiveIndex(Math.max(0, drivers.findIndex(driver => driver.id === selectedDriver?.id))); } }}
      onToggle={event => { const expanded = event.newState === 'open'; setOpen(expanded); if (expanded) searchRef.current?.focus(); }}
      onBlur={event => { if (event.relatedTarget && event.relatedTarget !== triggerRef.current && !event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}>
      <header><strong>{t('documentImportSelection.title')}</strong><span>{drivers.length}</span></header>
      <label className="fleet-driver-search"><Search size={17} aria-hidden="true" />
        <input ref={searchRef} type="search" value={query} placeholder={t('documentImportSelection.searchPlaceholder')} aria-label={t('documentImportSelection.searchLabel')}
          autoComplete="off" onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusOption(event.key === 'ArrowDown' ? active : filtered.length - 1); }
            else if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); select(filtered[active]); }
          }} />
      </label>
      <div ref={listRef} className="fleet-driver-options" role="group" aria-label={t('documentImportSelection.drivers')}>
        {filtered.map((driver, index) => <button key={driver.id} type="button" className={`fleet-driver-option${driver.id === selectedDriver?.id ? ' is-selected' : ''}`}
          aria-pressed={driver.id === selectedDriver?.id} tabIndex={index === active ? 0 : -1} onFocus={() => setActiveIndex(index)} onClick={() => select(driver)}
          onKeyDown={event => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
            }
          }}>
          <DriverAvatar driver={driver} />
          <span className="fleet-driver-option-copy"><strong>{name(driver)}</strong><span><Truck size={12} aria-hidden="true" />{metadata(driver)}</span><DriverPresence driver={driver} /></span>
          {driver.id === selectedDriver?.id && <Check size={17} className="fleet-driver-check" aria-hidden="true" />}
        </button>)}
        {!filtered.length && <div className="fleet-driver-empty" role="status"><UsersRound size={24} aria-hidden="true" /><strong>{t('documentImportSelection.noMatches')}</strong><p>{t('documentImportSelection.noMatchesHint')}</p></div>}
      </div>
    </section>
  </>;
}

function DriverAvatar({ driver }) {
  const initials = driver?.name?.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—';
  return driver?.avatar ? <img className="fleet-driver-avatar" src={driver.avatar} alt="" /> : <span className="fleet-driver-avatar" aria-hidden="true">{initials}</span>;
}

function DriverPresence({ driver }) {
  const { t } = useTranslation();
  return <span className={`fleet-driver-presence${driver.isOnline ? ' is-online' : ''}`}><i aria-hidden="true" />{t(driver.isOnline ? 'common.online' : 'common.offline')}</span>;
}
