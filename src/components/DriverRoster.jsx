import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Clock3,
  MapPin, 
  Plus, 
  Search,
  Truck,
  FileUp,
  PencilLine,
  UploadCloud,
} from 'lucide-react';
import { buildLoadDetails } from './loadDetailsModel';
import DriverSettingsPanel from './DriverSettingsPanel';
import KanbanBoard from './KanbanBoard';
import { formatAppointment, formatDate, formatTime } from '../i18n/format';
import {
  activeLoadsForDriver,
  completedDocumentLoads,
  lastSeenKind,
  partitionDriverLoads,
  rosterAppointment,
  rosterStopAddress,
} from './driverRosterModel';

export default function DriverRoster({
  drivers,
  loads,
  onAssignLoad,
  onOpenDocs,
  onDeleteLoad,
  onTrashLoad,
  onManageDocument,
  onImportDriverDocument,
  isAiProcessing = false,
  selectedDriverId,
  onSelectDriver,
  unreadChatsByDriver = {},
  onWorkspaceRefresh,
  canManageDriver = false,
}) {
  const { t } = useTranslation();
  const tabId = useId();
  const [tabSelection, setTabSelection] = useState({ driverId: selectedDriverId, tab: 'trips', settingsVisited: false, documentSearch: '' });
  if (tabSelection.driverId !== selectedDriverId) {
    setTabSelection({ driverId: selectedDriverId, tab: 'trips', settingsVisited: false, documentSearch: '' });
  }
  const activeTab = tabSelection.driverId === selectedDriverId ? tabSelection.tab : 'trips';
  const detailTabs = ['trips', 'analytics', 'documents', 'settings'];
  const selectTab = (tab) => setTabSelection((previous) => ({ ...previous, driverId: selectedDriverId, tab, settingsVisited: previous.driverId === selectedDriverId && previous.settingsVisited || tab === 'settings' }));
  const onTabKeyDown = (event) => {
    const index = detailTabs.indexOf(activeTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % detailTabs.length
      : event.key === 'ArrowLeft' ? (index + detailTabs.length - 1) % detailTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectTab(detailTabs[next]);
    event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus();
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [copiedLoadId, setCopiedLoadId] = useState(null);
  const [openMenuDriverId, setOpenMenuDriverId] = useState(null);
  const [isPdfDragging, setIsPdfDragging] = useState(false);
  const [dropError, setDropError] = useState('');
  const isAddMenuOpen = Boolean(selectedDriverId && openMenuDriverId === selectedDriverId);
  const addMenuRef = useRef(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!isAddMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!addMenuRef.current?.contains(event.target)) setOpenMenuDriverId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenMenuDriverId(null);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isAddMenuOpen]);

  const copyLoadNumber = async (event, load) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(load.loadNumber);
      setCopiedLoadId(load.id);
      window.setTimeout(() => setCopiedLoadId((current) => current === load.id ? null : current), 1500);
    } catch {
      // Clipboard permission can be denied by the browser; keep row navigation unaffected.
    }
  };

  const openDriver = (driverId) => {
    onSelectDriver(driverId);
  };

  const availableDriversCount = drivers.filter((driver) => driver.accountStatus !== 'suspended' && activeLoadsForDriver(loads, driver.id).length === 0).length;
  const onDutyDriversCount = drivers.filter((driver) => driver.accountStatus !== 'suspended' && activeLoadsForDriver(loads, driver.id).length > 0).length;

  const filteredDrivers = drivers.filter(driver => {
    const activeLoads = activeLoadsForDriver(loads, driver.id);
    
    if (statusFilter !== 'ALL' && driver.accountStatus === 'suspended') return false;
    // Status filter
    if (statusFilter === 'AVAILABLE' && activeLoads.length) return false;
    if (statusFilter === 'ON_LOAD' && !activeLoads.length) return false;

    // Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      driver.name.toLowerCase().includes(q) ||
      (driver.truck && driver.truck.toLowerCase().includes(q)) ||
      (driver.trailer && driver.trailer.toLowerCase().includes(q)) ||
      (driver.currentLocation && driver.currentLocation.toLowerCase().includes(q)) ||
      (driver.driverNumber && driver.driverNumber.toLowerCase().includes(q)) ||
      activeLoads.some((load) => load.loadNumber.toLowerCase().includes(q))
    );
  });

  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);

  const isSuspended = selectedDriver?.accountStatus === 'suspended';
  const isFileDrag = (event) => !isSuspended && (Array.from(event.dataTransfer?.types || []).includes('Files')
    || Boolean(event.dataTransfer?.files?.length));
  const onPageDragEnter = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropError('');
    setIsPdfDragging(true);
  };
  const onPageDragOver = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onPageDragLeave = (event) => {
    if (!isFileDrag(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsPdfDragging(false);
  };
  const onPageDrop = (event) => {
    if (!isFileDrag(event)) return;
    const handledByColumn = event.defaultPrevented;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsPdfDragging(false);
    if (handledByColumn || isAiProcessing || !selectedDriver || isSuspended) return;
    const pdf = Array.from(event.dataTransfer.files || []).find(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
    );
    if (!pdf) {
      setDropError(t('drivers.pdfDropOnly'));
      return;
    }
    setOpenMenuDriverId(null);
    onImportDriverDocument?.(pdf, selectedDriver.id);
  };

  if (selectedDriver) {
    const driverLoads = loads.filter((load) => load.driverId === selectedDriver.id);
    const { workflow, exceptions } = partitionDriverLoads(driverLoads);
    const activeTripCount = workflow.filter((load) => load.status !== 'COMPLETED').length;
    const completedTripCount = workflow.length - activeTripCount;
    const documentQuery = (tabSelection.documentSearch || '').trim().toLocaleLowerCase();
    const completedLoads = completedDocumentLoads(driverLoads);
    const documentLoads = completedLoads.filter((load) => !documentQuery || [
      load.loadNumber, load.origin?.city, load.origin?.state, load.destination?.city, load.destination?.state,
    ].some((value) => String(value || '').toLocaleLowerCase().includes(documentQuery)));

    return (
      <div className="driver-trips-view" onDragEnter={onPageDragEnter} onDragOver={onPageDragOver} onDragLeave={onPageDragLeave} onDrop={onPageDrop}>
        {isPdfDragging && <div className="driver-trip-drop-overlay" aria-hidden="true">
          <UploadCloud size={42} />
          <strong>{t('drivers.pdfDropTitle')}</strong>
          <span>{t('loads.aiDropHint')}</span>
        </div>}
        {dropError && <p className="driver-trip-drop-error" role="alert">{dropError}</p>}
        <section className="driver-trip-summary" aria-label={t('drivers.driver')}>
          <div className="driver-trip-identity">
            <div className="driver-trip-avatar">
              <span>{selectedDriver.name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
              {selectedDriver.avatar && <img src={selectedDriver.avatar} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
            </div>
            <div className="driver-trip-identity-copy">
              <div className="driver-trip-name-row">
                <h1>{selectedDriver.name}</h1>
                <span className={`driver-trip-availability ${isSuspended ? 'is-suspended' : activeTripCount > 0 ? 'is-active' : ''}`}>
                  <span />{isSuspended ? t('driverSettings.suspended') : activeTripCount > 0 ? t('drivers.onLoad') : t('drivers.available')}
                </span>
              </div>
              {(selectedDriver.driverNumber || selectedDriver.truck || selectedDriver.trailer) && (
                <p><Truck size={16} />{[selectedDriver.driverNumber, selectedDriver.truck, selectedDriver.trailer].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          </div>
          <div className="driver-trip-stats">
            <div><span>{t('loads.allTrips')}</span><strong>{workflow.length}</strong></div>
            <div><span>{t('drivers.activeTrips')}</span><strong>{activeTripCount}</strong></div>
            <div><span>{t('loadStatus.completed')}</span><strong>{completedTripCount}</strong></div>
          </div>
          <div className="driver-trip-add-wrap" ref={addMenuRef}>
            <button type="button" className="driver-trip-add" disabled={isSuspended} title={isSuspended ? t('driverSettings.suspended') : undefined} aria-expanded={isAddMenuOpen} aria-controls="driver-trip-add-options" onClick={() => setOpenMenuDriverId(isAddMenuOpen ? null : selectedDriver.id)}>
              <Plus size={20} />{t('loads.addForDriver')}
            </button>
            {isAddMenuOpen && !isSuspended && <div id="driver-trip-add-options" className="driver-trip-add-options">
              <label className="driver-trip-add-option">
                <FileUp size={18} />{t('loads.addPdf')}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) {
                    setOpenMenuDriverId(null);
                    onImportDriverDocument?.(file, selectedDriver.id);
                  }
                }} />
              </label>
              <button type="button" className="driver-trip-add-option" onClick={() => {
                setOpenMenuDriverId(null);
                onAssignLoad?.(selectedDriver);
              }}>
                <PencilLine size={18} />{t('loads.addManually')}
              </button>
            </div>}
          </div>
        </section>
        <div className="driver-detail-tabs" role="tablist" aria-label={t('driverDetailTabs.navigation')} onKeyDown={onTabKeyDown}>
          {detailTabs.map((tab) => <button key={tab} type="button" role="tab" id={`${tabId}-${tab}-tab`} aria-controls={`${tabId}-${tab}-panel`} aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} onClick={() => selectTab(tab)}>{t(`driverDetailTabs.${tab}`)}</button>)}
        </div>
        <section className="driver-trips-content" role="tabpanel" id={`${tabId}-trips-panel`} aria-labelledby={`${tabId}-trips-tab`} hidden={activeTab !== 'trips'}>
          <DriverLoadWorkspace
            loads={workflow}
            drivers={drivers}
            onOpenDocs={onOpenDocs}
            onDeleteLoad={onDeleteLoad}
            onTrashLoad={onTrashLoad}
            onManageDocument={onManageDocument}
            onImportDocument={isSuspended ? undefined : (file) => onImportDriverDocument?.(file, selectedDriver.id)}
            isAiProcessing={isAiProcessing}
          />
          {exceptions.length > 0 && (
            <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
              <summary className="cursor-pointer text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t('drivers.exceptionTrips', { count: exceptions.length })}
              </summary>
              <div className="mt-3 space-y-2">
                {exceptions.map((load) => (
                  <button key={load.id} type="button" onClick={() => onOpenDocs(load)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm hover:border-teal-500 dark:border-zinc-700 dark:bg-zinc-900">
                    <span className="font-semibold">{load.loadNumber}</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-300">{t(`loadStatus.${load.databaseStatus}`)}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </section>
        {detailTabs.filter((tab) => tab !== 'trips').map((tab) => <section key={tab} className="driver-detail-panel" role="tabpanel" id={`${tabId}-${tab}-panel`} aria-labelledby={`${tabId}-${tab}-tab`} hidden={activeTab !== tab} tabIndex={0}>
          {tab !== 'settings' && <h2>{t(`driverDetailTabs.${tab}`)}</h2>}
          {tab === 'settings' && tabSelection.settingsVisited && <DriverSettingsPanel key={selectedDriver.id} driver={selectedDriver} onWorkspaceRefresh={onWorkspaceRefresh} canManageDriver={canManageDriver} />}
          {tab === 'equipment' && <dl className="driver-detail-facts">{['truck', 'trailer'].map((field) => <div key={field}><dt>{t(`driverDetailTabs.${field}`)}</dt><dd>{selectedDriver[field] || '—'}</dd></div>)}</dl>}
          {tab === 'documents' && <>
            <p className="driver-detail-note">{t('driverDetailTabs.loadDocuments')}</p>
            <label className="driver-document-search"><Search size={17} aria-hidden="true" /><span className="sr-only">{t('driverDetailTabs.documentSearch')}</span><input type="search" value={tabSelection.documentSearch || ''} onChange={(event) => setTabSelection((previous) => ({ ...previous, documentSearch: event.target.value }))} placeholder={t('driverDetailTabs.documentSearch')} /></label>
            <div className="driver-detail-documents">{documentLoads.length ? documentLoads.map((load) => {
              const details = buildLoadDetails(load);
              const delivery = details.stops.filter((stop) => stop.role === 'delivery').at(-1) || details.delivery;
              const appointment = delivery.appointment;
              const deliverySchedule = [delivery.scheduleDate, delivery.scheduleTime].filter(Boolean).join(' · ')
                || (appointment ? formatAppointment(appointment, delivery.timezone) : '—');
              const route = [load.origin, load.destination].map((stop) => [stop?.city, stop?.state].filter(Boolean).join(', ') || '—').join(' → ');
              return <button key={load.id} type="button" onClick={() => onOpenDocs(load)}>
                <FileUp size={18} aria-hidden="true" />
                <div className="driver-document-identity"><strong>{load.loadNumber}</strong><small>{route}</small></div>
                <div className="driver-document-delivery"><small>{t('driverDetailTabs.plannedDelivery')}</small><strong>{deliverySchedule}</strong></div>
                <span className="driver-document-open">{t('driverDetailTabs.openLoad')}</span>
              </button>;
            }) : <p role="status">{t(completedLoads.length ? 'driverDetailTabs.noDocumentMatches' : 'driverDetailTabs.noCompletedLoads')}</p>}</div>
          </>}
          {tab === 'activity' && <dl className="driver-detail-facts"><div><dt>{t('driverDetailTabs.connection')}</dt><dd>{t(selectedDriver.isOnline ? 'driverDetailTabs.online' : 'driverDetailTabs.offline')}</dd></div><div><dt>{t('driverDetailTabs.lastSeen')}</dt><dd>{lastSeenKind(selectedDriver.lastSeenAt) === 'never' ? t('driverDetailTabs.noActivity') : formatLastSeen(t, selectedDriver.lastSeenAt)}</dd></div></dl>}
          {tab === 'analytics' && <dl className="driver-detail-facts driver-detail-counts">{[
            ['total', driverLoads.length], ['active', activeTripCount], ['completed', completedTripCount], ['exceptions', exceptions.length],
          ].map(([label, count]) => <div key={label}><dt>{t(`driverDetailTabs.${label}`)}</dt><dd>{count}</dd></div>)}</dl>}
        </section>)}
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-12">
      {/* Filters & Search Row */}
      <div className="driver-list-toolbar">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('drivers.searchPlaceholder')}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
          />
        </div>

        <div className="driver-list-actions">
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 text-xs font-bold">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('common.all')} ({drivers.length})
          </button>
          <button
            onClick={() => setStatusFilter('AVAILABLE')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'AVAILABLE'
                ? 'bg-white dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('drivers.available')} ({availableDriversCount})
          </button>
          <button
            onClick={() => setStatusFilter('ON_LOAD')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ON_LOAD'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('drivers.onLoad')} ({onDutyDriversCount})
          </button>
          </div>
        </div>
      </div>

      {/* Full-Width Clean Table — No Card Box */}
      <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="py-3.5 px-4">{t('drivers.driver')}</th>
              <th className="py-3.5 px-4">{t('drivers.pickupLocation')}</th>
              <th className="py-3.5 px-4">{t('drivers.deliveryLocation')}</th>
              <th className="py-3.5 px-4">{t('drivers.lastSeen')}</th>
              <th className="py-3.5 px-4 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {filteredDrivers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-zinc-400 font-medium">
                  {t('drivers.noDrivers')}
                </td>
              </tr>
            ) : (
              filteredDrivers.map((driver) => {
                const activeLoads = activeLoadsForDriver(loads, driver.id);
                const hasActiveLoads = activeLoads.length > 0;
                const unreadChatCount = unreadChatsByDriver[driver.id] || 0;

                return (
                  <tr 
                    key={driver.id} 
                    role="button"
                    tabIndex={0}
                    onClick={() => openDriver(driver.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDriver(driver.id);
                      }
                    }}
                    className="driver-row hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    aria-label={t('drivers.openDetails', { name: driver.name })}
                  >
                    {/* Driver Info */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="relative flex-shrink-0">
                          <div className="relative w-11 h-11 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-sm text-zinc-800 dark:text-zinc-200">
                            {driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}
                            {driver.avatar && (
                              <img
                                src={driver.avatar}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                onError={(event) => { event.currentTarget.style.display = 'none'; }}
                              />
                            )}
                          </div>
                          {unreadChatCount > 0 && (
                            <span
                              className="absolute -right-2 -top-2 z-10 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-black leading-none text-white shadow-sm dark:border-zinc-950"
                              title={t('chat.unreadMessages', { count: unreadChatCount })}
                              aria-label={t('chat.unreadMessages', { count: unreadChatCount })}
                            >
                              {unreadChatCount > 99 ? '99+' : unreadChatCount}
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-1.5 whitespace-nowrap">
                            <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{driver.name}</span>{driver.accountStatus === 'suspended' && <span className="text-xs text-amber-700">{t('driverSettings.suspended')}</span>}
                          </div>
                          <div className="mt-1 space-y-0.5 font-mono text-xs font-bold text-blue-700 dark:text-blue-300">
                            {hasActiveLoads
                              ? activeLoads.map((load) => (
                                <button
                                  key={load.id}
                                  type="button"
                                  onClick={(event) => copyLoadNumber(event, load)}
                                  className="flex items-center gap-1 rounded text-left transition hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                  title={copiedLoadId === load.id ? t('drivers.copied') : t('drivers.copyLoadNumber')}
                                >
                                  {copiedLoadId === load.id && <Check className="h-3 w-3" aria-hidden="true" />}
                                  <span>{load.loadNumber}</span>
                                </button>
                              ))
                              : <span className="font-normal text-zinc-400">{t('drivers.noCurrentLoad')}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Pickup address and appointment */}
                    <td className="py-3.5 px-4 align-top">
                      <LoadStops
                        loads={activeLoads}
                        stopKey="origin"
                        emptyLabel={t('drivers.noCurrentLoad')}
                        timeLabel={t('drivers.pickupTime')}
                      />
                    </td>

                    {/* Delivery address and appointment */}
                    <td className="py-3.5 px-4 align-top">
                      <LoadStops
                        loads={activeLoads}
                        stopKey="destination"
                        emptyLabel={t('drivers.noCurrentLoad')}
                        timeLabel={t('drivers.deliveryTime')}
                      />
                    </td>

                    {/* Last app activity */}
                    <td className="py-3.5 px-4 whitespace-nowrap align-top">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        <Clock3 className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span>{formatLastSeen(t, driver.lastSeenAt)}</span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            if (driver.accountStatus !== 'suspended') onAssignLoad(driver);
                          }}
                          disabled={driver.accountStatus === 'suspended'}
                          className="inline-flex items-center space-x-1.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-colors shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={driver.accountStatus === 'suspended' ? t('driverSettings.suspended') : hasActiveLoads ? t('drivers.assignAdditional') : t('drivers.assignLoad')}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{hasActiveLoads ? t('drivers.additionalLoad') : t('header.createLoad')}</span>
                        </button>
                      </div>
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function LoadStops({ loads, stopKey, emptyLabel, timeLabel }) {
  if (!loads.length) return <span className="text-sm text-zinc-400">{emptyLabel}</span>;

  return (
    <div className="space-y-2.5">
      {loads.map((load, index) => {
        const stop = load[stopKey];
        const address = rosterStopAddress(stop);
        const appointment = rosterAppointment(stop);
        return (
          <div key={load.id} className={index ? 'border-t border-zinc-200 pt-2.5 dark:border-zinc-800' : ''}>
            <div className="flex max-w-[240px] items-start gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              <span className="line-clamp-2" title={address || undefined}>{address || '—'}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 pl-5 text-xs text-zinc-500 dark:text-zinc-400">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              <span aria-label={timeLabel}>{appointment ? formatAppointment(appointment, stop.timezone, { timeOnly: true }) : '—'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatLastSeen(t, value) {
  const kind = lastSeenKind(value);
  if (kind === 'never') return t('drivers.neverSeen');
  if (kind === 'yesterday') return t('common.yesterday');
  if (kind === 'time') return t('drivers.lastSeenTime', { time: formatTime(value) });
  return formatDate(value, { dateStyle: 'medium' });
}

function DriverLoadWorkspace({
  loads,
  drivers,
  onOpenDocs,
  onDeleteLoad,
  onTrashLoad,
  onManageDocument,
  onImportDocument,
  isAiProcessing,
}) {
  return (
    <div className="driver-workspace">
      <KanbanBoard
        loads={loads}
        drivers={drivers}
        onOpenDocs={onOpenDocs}
        onDeleteLoad={onDeleteLoad}
        onTrashLoad={onTrashLoad}
        onManageDocument={onManageDocument}
        onAssignedDocumentUpload={onImportDocument}
        isAiProcessing={isAiProcessing}
        includeUnassigned={false}
        hideStageFilters
        boardOnly
        driverWorkspace
        groupDeliveredWithOnRoad
        hideCompletedCardFooter
      />
    </div>
  );
}
