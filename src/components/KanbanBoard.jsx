import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Columns3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Table as TableIcon,
  Sparkles,
  UploadCloud,
  Trash2,
  LoaderCircle,
  Search,
  MapPin,
  CircleDollarSign,
  Building2,
  Truck,
  UsersRound,
  FileText,
} from 'lucide-react';
import { formatAppointment, formatCurrency, formatDate } from '../i18n/format';
import { stopCalendarDate } from '../i18n/stopAppointment.js';
import { displayBoardStage } from '../services/loadBoardStatus';
import { filterWorkspaceLoads } from './loadWorkspaceModel';
import { localizedError } from '../i18n/errors';
const LoadDetailsModal = React.lazy(() => import('./LoadDetailsModal'));

function getClipboardImage(clipboardData) {
  const imageItem = Array.from(clipboardData?.items || []).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  const itemFile = imageItem?.getAsFile();
  if (itemFile) return itemFile;

  return Array.from(clipboardData?.files || []).find(
    (file) => file.type.startsWith('image/'),
  ) || null;
}

function toCalendarDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftCalendarMonth({ year, month }, offset) {
  const shifted = new Date(year, month + offset, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

export default function KanbanBoard({ 
  loads, 
  drivers, 
  onOpenDocs, 
  onDeleteLoad,
  onTrashLoad,
  onSendOffer,
  onDropOnOffer,
  onAssignedDocumentUpload,
  isAiProcessing = false,
  includeUnassigned = true,
  hideStageFilters = false,
  boardOnly = false,
  driverWorkspace = false,
  fleetWorkspace = false,
  groupDeliveredWithOnRoad = false,
  hideCompletedCardFooter = false,
}) {
  const { t } = useTranslation();
  const styledWorkspace = driverWorkspace || fleetWorkspace;
  const driversById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);
  const allStages = [
    { id: 'UNASSIGNED', title: t('loadStatus.unassigned'), dot: 'bg-zinc-400' },
    { id: 'ASSIGNED', title: t('loadStatus.assigned'), dot: 'bg-blue-500' },
    { id: 'PICKED_UP', title: t('loadStatus.picked_up'), dot: 'bg-teal-500' },
    { id: 'ON_ROAD', title: t('loadStatus.on_road'), dot: 'bg-blue-700' },
    { id: 'DELIVERED', title: t('loadStatus.delivered'), dot: 'bg-emerald-500' },
    { id: 'COMPLETED', title: t('loadStatus.completed'), dot: 'bg-zinc-400' },
  ];
  const stages = allStages.filter((stage) => (
    (includeUnassigned || stage.id !== 'UNASSIGNED')
    && (!groupDeliveredWithOnRoad || stage.id !== 'DELIVERED')
  ));
  const stageForLoad = (load) => displayBoardStage(load.status, groupDeliveredWithOnRoad);
  const calendarDays = Array.from({ length: 7 }, (_, index) => formatDate(
    new Date(2026, 0, 5 + index),
    { weekday: 'short' },
  ));
  const [viewMode, setViewMode] = useState(() => (
    boardOnly || typeof localStorage === 'undefined' || localStorage.getItem('drivex_load_view_mode') === 'kanban' ? 'kanban' : 'table'
  ));
  const activeView = boardOnly ? 'kanban' : viewMode;
  const [stageFilter, setStageFilter] = useState('ALL');
  const [tripSearch, setTripSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState('ALL');
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [isDraggingOverOffer, setIsDraggingOverOffer] = useState(false);
  const [isPasteTargetHovered, setIsPasteTargetHovered] = useState(false);
  const [loadPendingDelete, setLoadPendingDelete] = useState(null);
  const [selectedLoadDetails, setSelectedLoadDetails] = useState(null);
  const closeLoadDetails = useCallback(() => setSelectedLoadDetails(null), []);
  const detailsLoad = loads.find(load => load.id === selectedLoadDetails?.id);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const calendarPopoverRef = useRef(null);

  const importDocument = onAssignedDocumentUpload || onDropOnOffer;
  const submitDocumentFile = useCallback((file) => {
    if (!file || !importDocument || isAiProcessing) return;
    importDocument(file);
  }, [importDocument, isAiProcessing]);

  useEffect(() => {
    if (!isPasteTargetHovered) return undefined;

    const handleClipboardPaste = (event) => {
      const image = getClipboardImage(event.clipboardData);
      if (!image) return;

      event.preventDefault();
      submitDocumentFile(image);
    };

    window.addEventListener('paste', handleClipboardPaste);
    return () => window.removeEventListener('paste', handleClipboardPaste);
  }, [isPasteTargetHovered, submitDocumentFile]);

  useEffect(() => {
    if (!isDateFilterOpen) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (!calendarPopoverRef.current?.contains(event.target)) {
        setIsDateFilterOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isDateFilterOpen]);

  const pasteTargetProps = {
    onMouseEnter: () => setIsPasteTargetHovered(true),
    onMouseLeave: () => setIsPasteTargetHovered(false),
    onFocus: () => setIsPasteTargetHovered(true),
    onBlur: () => setIsPasteTargetHovered(false),
  };

  const filterStart = dateFrom || dateTo;
  const filterEnd = dateTo || dateFrom;
  const hasDateFilter = Boolean(filterStart);
  const boardLoads = includeUnassigned ? loads : loads.filter((load) => load.status !== 'UNASSIGNED');
  const searchedLoads = fleetWorkspace
    ? filterWorkspaceLoads(boardLoads, { query: tripSearch, driverId: driverFilter, driversById })
    : driverWorkspace && tripSearch.trim()
    ? boardLoads.filter((load) => [load.loadNumber, load.origin?.city, load.origin?.state, load.destination?.city, load.destination?.state, load.broker]
      .some((value) => String(value || '').toLowerCase().includes(tripSearch.trim().toLowerCase())))
    : boardLoads;
  const dateFilteredLoads = hasDateFilter
    ? searchedLoads.filter((load) => {
      const pickupDate = stopCalendarDate(load.origin?.date, load.origin?.timezone);
      const deliveryDate = stopCalendarDate(load.destination?.date, load.destination?.timezone) || pickupDate;
      return pickupDate && pickupDate <= filterEnd && deliveryDate >= filterStart;
    })
    : searchedLoads;
  const visibleLoads = stageFilter === 'ALL'
    ? dateFilteredLoads
    : dateFilteredLoads.filter((load) => stageForLoad(load) === stageFilter);

  const selectViewMode = (mode) => {
    localStorage.setItem('drivex_load_view_mode', mode);
    setViewMode(mode);
  };

  const selectCalendarDay = (day) => {
    if (!dateFrom || dateTo) {
      setDateFrom(day);
      setDateTo('');
      return;
    }

    if (day < dateFrom) {
      setDateTo(dateFrom);
      setDateFrom(day);
      return;
    }

    if (day !== dateFrom) setDateTo(day);
  };

  const getDriver = (driverId) => driversById.get(driverId);
  const hasWorkspaceFilters = Boolean(tripSearch.trim() || driverFilter !== 'ALL' || stageFilter !== 'ALL' || hasDateFilter);
  const clearWorkspaceFilters = () => {
    setTripSearch(''); setDriverFilter('ALL'); setStageFilter('ALL'); setDateFrom(''); setDateTo('');
  };
  const canDeleteLoad = (load) => (
    ['draft', 'review', 'ready_for_offer', 'offered'].includes(load.databaseStatus)
    && !load.currentAssignmentId
  );

  const confirmDelete = async () => {
    if (!loadPendingDelete || !(onTrashLoad || onDeleteLoad) || isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await (onTrashLoad || onDeleteLoad)(loadPendingDelete);
      setLoadPendingDelete(null);
    } catch (error) {
      setDeleteError(localizedError(t, error, onTrashLoad ? 'loadTrash.moveError' : 'errors.deleteLoad'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`loads-workspace space-y-4 ${styledWorkspace ? 'driver-board' : ''} ${fleetWorkspace ? 'fleet-loads-board' : ''}`} style={{ '--board-stage-count': stages.length + 1 }}>
      {!hideStageFilters && <div className="stage-filters" aria-label={t('loads.statusFilter')}>
        {[{ id: 'ALL', title: t('loads.all'), dot: 'bg-zinc-400' }, ...stages].map(stage => (
          <button
            key={stage.id}
            type="button"
            aria-pressed={stageFilter === stage.id}
            className={`stage-filter ${stageFilter === stage.id ? 'is-selected' : ''}`}
            onClick={() => setStageFilter(stage.id)}
          >
            <span className="stage-filter-label"><span className={`stage-dot ${stage.dot}`} />{stage.title}</span>
            <strong>{stage.id === 'ALL' ? dateFilteredLoads.length : dateFilteredLoads.filter(load => stageForLoad(load) === stage.id).length}</strong>
          </button>
        ))}
      </div>}
      <div className="board-toolbar">
        <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-500">
          {driverWorkspace && <h2 className="driver-board-title">{t('drivers.tripHistory')}</h2>}
          {fleetWorkspace && <h2 className="driver-board-title">{t('loadsWorkspace.boardTitle')} <span className="toolbar-count" aria-live="polite">{visibleLoads.length}</span></h2>}
          {!styledWorkspace && <>
          <span>{stageFilter === 'ALL' ? t('loads.allTrips') : stages.find(stage => stage.id === stageFilter)?.title} <span className="toolbar-count">{visibleLoads.length}</span></span>
          {hasDateFilter && (
            <span className="truncate text-xs text-zinc-400" title={`Reys sanasi: ${filterStart}${filterStart !== filterEnd ? ` — ${filterEnd}` : ''}`}>
              {filterStart}{filterStart !== filterEnd ? ` — ${filterEnd}` : ''}
            </span>
          )}
          </>}
        </div>

        <div ref={calendarPopoverRef} className="relative flex items-center gap-2">
          {styledWorkspace && <>
            <label className="driver-board-search"><Search size={17} /><input type="search" value={tripSearch} onChange={(event) => setTripSearch(event.target.value)} aria-label={t(fleetWorkspace ? 'loadsWorkspace.searchPlaceholder' : 'drivers.tripSearchPlaceholder')} placeholder={t(fleetWorkspace ? 'loadsWorkspace.searchPlaceholder' : 'drivers.tripSearchPlaceholder')} /></label>
            {fleetWorkspace && <label className="fleet-driver-filter"><UsersRound size={16} aria-hidden="true" /><select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} aria-label={t('loadsWorkspace.driverFilter')}>
              <option value="ALL">{t('loadsWorkspace.allDrivers')}</option>
              <option value="UNASSIGNED">{t('loadsWorkspace.unassignedDriver')}</option>
              {drivers.map((driver) => <option key={driver.id} value={driver.id}>{[driver.name || t('loadsWorkspace.missingDriver'), driver.driverNumber].filter(Boolean).join(' · ')}</option>)}
            </select></label>}
            <select className="driver-board-status" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} aria-label={t('loads.statusFilter')}>
              <option value="ALL">{t('drivers.allStatuses')}</option>
              {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
            </select>
          </>}
          {/* View Toggle */}
          {!styledWorkspace && <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1">
            <button
              onClick={() => selectViewMode('kanban')}
              aria-pressed={activeView === 'kanban'}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                activeView === 'kanban'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Columns3 className="w-4 h-4" />
              <span>{t('loads.board')}</span>
            </button>
            {!boardOnly && <button
              onClick={() => selectViewMode('table')}
              aria-pressed={activeView === 'table'}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                activeView === 'table'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <TableIcon className="w-4 h-4" />
              <span>{t('loads.table')}</span>
            </button>}
          </div>}

          <button
            type="button"
            aria-label={t('loads.dateFilter')}
            aria-expanded={isDateFilterOpen}
            onClick={() => setIsDateFilterOpen((isOpen) => !isOpen)}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              hasDateFilter
                ? 'border-teal-600 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-300'
                : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
            title={t('loads.dateFilter')}
          >
            <CalendarDays className="h-5 w-5" />
            {styledWorkspace && <span>{hasDateFilter ? `${filterStart}${filterStart !== filterEnd ? ` — ${filterEnd}` : ''}` : t('drivers.allDates')}</span>}
          </button>

          {isDateFilterOpen && (
            <div className="absolute right-0 top-11 z-30 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{t('loads.tripDate')}</p>
                <p className="mt-0.5 text-xs leading-5 text-zinc-500">{t('loads.dateRangeHint')}</p>
              </div>
              <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, -1))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label={t('loads.previousMonth')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {formatDate(new Date(calendarMonth.year, calendarMonth.month, 1), { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, 1))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label={t('loads.nextMonth')}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {calendarDays.map((dayName) => (
                    <span key={dayName} className="py-1 text-[10px] font-bold text-zinc-400">{dayName}</span>
                  ))}
                  {Array.from({ length: (new Date(calendarMonth.year, calendarMonth.month, 1).getDay() + 6) % 7 }).map((_, index) => (
                    <span key={`blank-${index}`} />
                  ))}
                  {Array.from({ length: new Date(calendarMonth.year, calendarMonth.month + 1, 0).getDate() }).map((_, index) => {
                    const dayNumber = index + 1;
                    const day = toCalendarDate(calendarMonth.year, calendarMonth.month, dayNumber);
                    const isRangeDay = Boolean(dateFrom && dateTo && day > dateFrom && day < dateTo);
                    const isSelectedDay = day === dateFrom || day === dateTo;
                    const today = new Date();
                    const isToday = day === toCalendarDate(today.getFullYear(), today.getMonth(), today.getDate());

                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => selectCalendarDay(day)}
                        className={`h-8 rounded-md text-xs font-semibold transition-colors ${
                          isSelectedDay
                            ? 'bg-teal-600 text-white hover:bg-teal-700'
                            : isRangeDay
                              ? 'bg-teal-50 text-teal-800 hover:bg-teal-100 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-950/70'
                              : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                        } ${isToday && !isSelectedDay ? 'ring-1 ring-teal-500 ring-inset' : ''}`}
                        aria-label={day}
                        aria-pressed={isSelectedDay}
                      >
                        {dayNumber}
                      </button>
                    );
                  })}
                </div>
              </div>
              {hasDateFilter && (
                <p className="mt-3 text-xs font-semibold text-teal-700 dark:text-teal-300">
                  {filterStart}{filterStart !== filterEnd ? ` — ${filterEnd}` : ''}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  disabled={!hasDateFilter}
                  className="text-xs font-bold text-zinc-500 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-zinc-100"
                >
                  {t('loads.clear')}
                </button>
                <button
                  type="button"
                  onClick={() => setIsDateFilterOpen(false)}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                >
                  {t('loads.view')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {fleetWorkspace && hasWorkspaceFilters && <div className="fleet-loads-filter-feedback">
        <span role="status">{visibleLoads.length === 0 ? t('loadsWorkspace.noResults') : t('loadsWorkspace.totalLoads', { count: visibleLoads.length }) + ': ' + visibleLoads.length}</span>
        <button type="button" onClick={clearWorkspaceFilters}>{t('loadsWorkspace.clearFilters')}</button>
      </div>}

      {/* 1. Kanban View */}
      {activeView === 'kanban' && (
        <div className="kanban-columns" style={{ '--board-column-count': stageFilter === 'ALL' ? stages.length : 1 }}>
          {stages.filter(col => stageFilter === 'ALL' || col.id === stageFilter).map((col) => {
            const colLoads = dateFilteredLoads.filter((load) => stageForLoad(load) === col.id);
            const isOfferCol = col.id === 'UNASSIGNED';
            const isAssignedImportCol = col.id === 'ASSIGNED' && Boolean(onAssignedDocumentUpload);
            const isUploadCol = (isOfferCol && Boolean(onDropOnOffer)) || isAssignedImportCol;

            return (
              <div 
                key={col.id} 
                {...(styledWorkspace && isUploadCol ? pasteTargetProps : {})}
                onDragOver={(e) => {
                  if (isUploadCol && !isAiProcessing) {
                    e.preventDefault();
                    setIsDraggingOverOffer(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (isUploadCol) {
                    e.preventDefault();
                    setIsDraggingOverOffer(false);
                  }
                }}
                onDrop={(e) => {
                  if (isUploadCol) {
                    e.preventDefault();
                    setIsDraggingOverOffer(false);
                    submitDocumentFile(e.dataTransfer.files?.[0]);
                  }
                }}
                className={`kanban-column ${styledWorkspace ? `driver-board-column stage-${col.id.toLowerCase()}` : ''} relative bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-200/50 dark:border-zinc-800/50 rounded-2xl p-3 flex flex-col min-w-[240px] min-h-[560px] transition-all ${
                  isUploadCol && isDraggingOverOffer
                    ? 'border-blue-500 ring-4 ring-blue-500/20 bg-blue-50/30 dark:bg-blue-950/40'
                    : ''
                }`}
              >
                {/* Drag-over full column overlay */}
                {isUploadCol && isDraggingOverOffer && (
                  <div className="absolute inset-0 border-3 border-dashed border-blue-500 bg-blue-50/95 dark:bg-zinc-950/95 rounded-2xl flex flex-col items-center justify-center p-6 text-center z-30 pointer-events-none animate-in fade-in duration-100 shadow-2xl">
                    <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xl mb-3 animate-bounce">
                      <UploadCloud className="w-8 h-8" />
                    </div>
                    <span className="text-lg font-bold text-zinc-900 dark:text-white">
                      {t('loads.drop')}
                    </span>
                    <span className="text-sm text-blue-600 dark:text-blue-400 mt-1 font-medium max-w-[220px]">
                      {t('loads.aiDropHint')}
                    </span>
                  </div>
                )}

                {/* Stage Title */}
                <div className={`flex items-center justify-between pb-3 mb-3 border-b border-zinc-200 dark:border-zinc-800/60 ${styledWorkspace ? 'driver-board-stage-header' : ''}`}>
                  <div className="flex items-center space-x-2.5">
                    <span className={`w-3 h-3 rounded-full ${col.dot}`} />
                    <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">{col.title}</span>
                  </div>
                  <span className="text-sm font-mono font-bold text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                    {colLoads.length}
                  </span>
                </div>

                {/* Cards / compact upload card when the offer column is empty */}
                <div className="kanban-card-list space-y-3 flex-1 flex flex-col overflow-y-auto">
                  {colLoads.length === 0 ? (
                    styledWorkspace ? (
                      <div className="driver-board-empty"><Truck size={40} strokeWidth={1.4} /><strong>{t('drivers.noTripsInStage')}</strong></div>
                    ) :
                    isUploadCol ? (
                      /* Keep the upload target aligned with a normal load card. */
                      <label 
                        {...pasteTargetProps}
                        tabIndex={0}
                        className="relative flex-none min-h-[210px] border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center p-4 text-center bg-white/50 dark:bg-zinc-900/40 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 cursor-pointer transition-all group select-none shadow-2xs focus-within:ring-2 focus-within:ring-blue-500"
                        title={t('loads.dropHint')}
                      >
                        <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 group-hover:scale-110 transition-transform shadow-xs">
                          {isAssignedImportCol ? <Plus className="w-8 h-8" /> : <UploadCloud className="w-8 h-8" />}
                        </div>
                        <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
                          {isAssignedImportCol ? t('loads.addForDriver') : t('loads.drop')}
                        </span>
                        <span className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-sm font-bold shadow-xs group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          {isAssignedImportCol ? <Plus className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-amber-400" />}
                          <span>{t('loads.chooseFile')}</span>
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
                          aria-label={t('loads.addForDriver')}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            submitDocumentFile(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    ) : (
                      <div className="h-32 flex items-center justify-center border border-dashed border-zinc-200 dark:border-zinc-800/50 rounded-xl text-zinc-400 text-sm font-medium">
                        {t('common.notAvailable')}
                      </div>
                    )
                  ) : (
                    <>
                      {/* Keep import available even when the column already contains loads. */}
                      {isUploadCol && !styledWorkspace && (
                        <label 
                          {...pasteTargetProps}
                          tabIndex={0}
                          className="flex items-center justify-center space-x-2 py-3 px-3.5 rounded-xl border-2 border-dashed border-blue-400/60 dark:border-blue-600/50 hover:border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/20 cursor-pointer text-sm font-bold transition-all shadow-xs group"
                          title={t('loads.dropMore')}
                        >
                          <UploadCloud className="w-4 h-4 group-hover:scale-110 transition-transform" />
                          <span>{isAssignedImportCol ? t('loads.addForDriver') : t('loads.dropMoreAi')}</span>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              submitDocumentFile(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}

                      {colLoads.map((load) => {
                        const driver = getDriver(load.driverId);
                        const driverName = driver?.name || (load.driverId ? t('loadsWorkspace.missingDriver') : t('loads.unassigned'));
                        const canAssign = onSendOffer && ['ready_for_offer', 'offered'].includes(load.databaseStatus);
                        const canOpenDocuments = load.status === 'COMPLETED' && onOpenDocs;
                        const canDelete = (onTrashLoad || onDeleteLoad) && canDeleteLoad(load);

                        return styledWorkspace ? (
                          <div key={load.id} role="button" tabIndex={0} className="driver-trip-card" onClick={() => setSelectedLoadDetails(load)} onKeyDown={(event) => {
                            if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedLoadDetails(load); }
                          }}>
                            <div className="driver-trip-card-top"><strong>#{String(load.loadNumber || '').replace(/^#/, '')}</strong><span className={`driver-trip-stage stage-${col.id.toLowerCase()}`}>{load.status === 'DELIVERED' ? t('loads.awaitingCompletion') : col.title}</span></div>
                            <p className="driver-trip-card-route"><MapPin size={15} /><span>{[load.origin?.city, load.origin?.state].filter(Boolean).join(', ') || t('common.notProvided')}</span><span className="driver-trip-route-arrow">→</span><span>{[load.destination?.city, load.destination?.state].filter(Boolean).join(', ') || t('common.notProvided')}</span></p>
                            <p><CircleDollarSign size={15} /><strong>{formatCurrency(load.rate)}</strong></p>
                            <p><Building2 size={15} /><span>{load.broker || t('inbox.brokerMissing')}</span></p>
                            {load.equipment && <p><Truck size={15} /><span>{load.equipment}</span></p>}
                            {fleetWorkspace && <p className="fleet-load-driver" title={driverName}>
                              <UsersRound size={15} aria-hidden="true" />
                              <span>{driverName}
                                {load.status === 'UNASSIGNED' && load.targetDriverIds?.length > 1 && <small>{t('loads.offeredDrivers', { count: load.targetDriverIds.length })}</small>}
                              </span>
                            </p>}
                            {(load.origin?.date || load.destination?.date) && <p className="driver-trip-card-date"><CalendarDays size={15} /><span>{formatAppointment(load.origin?.date || load.destination?.date, load.origin?.date ? load.origin.timezone : load.destination?.timezone, { dateOnly: true })}</span></p>}
                            {fleetWorkspace && (canAssign || canOpenDocuments || canDelete) && <div className="fleet-load-card-actions">
                              {canAssign && <button type="button" className="fleet-load-assign" onClick={(event) => { event.stopPropagation(); onSendOffer(load); }}>{t('loads.assignToDriver')}</button>}
                              {canOpenDocuments && <button type="button" className="fleet-load-documents" onClick={(event) => { event.stopPropagation(); onOpenDocs(load); }} title={t('nav.documents')} aria-label={t('nav.documents')}><FileText size={15} /></button>}
                              {canDelete && <button type="button" className="fleet-load-delete" onClick={(event) => { event.stopPropagation(); setLoadPendingDelete(load); }} aria-label={t(onTrashLoad ? 'loadTrash.moveTitle' : 'loads.deleteNamed', { number: load.loadNumber })} title={t(onTrashLoad ? 'loadTrash.move' : 'loads.deleteTitle')}><Trash2 size={15} /></button>}
                            </div>}
                          </div>
                        ) : (
                          <div
                            key={load.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedLoadDetails(load)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedLoadDetails(load);
                              }
                            }}
                            className="cursor-pointer bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-teal-400 dark:hover:border-teal-600 rounded-2xl p-3.5 space-y-2.5 transition-colors shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                          >
                            {/* Top Row: Load ID & Rate (No line wraps!) */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-sm text-zinc-500 whitespace-nowrap">
                                {load.loadNumber}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-extrabold text-base text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                                  {formatCurrency(load.rate)}
                                </span>
                                {canDeleteLoad(load) && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setLoadPendingDelete(load);
                                    }}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                    aria-label={t(onTrashLoad ? 'loadTrash.moveTitle' : 'loads.deleteNamed', { number: load.loadNumber })}
                                    title={t(onTrashLoad ? 'loadTrash.move' : 'loads.deleteTitle')}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Route: Clear & Bold (No truncated dots!) */}
                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                              {load.origin.city || t('common.notProvided')}, {load.origin.state} ➔ {load.destination.city || t('common.notProvided')}, {load.destination.state}
                            </div>

                            {/* Subtitle: Broker & Specs */}
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium flex items-center justify-between">
                              <span className="truncate mr-1">{load.broker || t('inbox.brokerMissing')}</span>
                              <span className="whitespace-nowrap font-mono">{load.equipment || t('common.notProvided')} • {load.distanceMiles}mi</span>
                            </div>

                            {/* Bottom Row: Driver & Action */}
                            {!(hideCompletedCardFooter && load.status === 'COMPLETED') && (
                            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                              {load.targetDriverIds && load.targetDriverIds.length > 1 && load.status === 'UNASSIGNED' ? (
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-bold">
                                  {t('loads.offeredDrivers', { count: load.targetDriverIds.length })}
                                </span>
                              ) : (
                                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate mr-1">
                                  {driver?.name || t('loads.unassigned')}
                                </span>
                              )}

                              {/* Single Action Button */}
                              {['ready_for_offer', 'offered'].includes(load.databaseStatus) && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSendOffer?.(load);
                                  }}
                                  className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
                                >
                                  {t('loads.assignToDriver')}
                                </button>
                              )}
                              {col.id === 'ASSIGNED' && (
                                <span className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-lg font-bold whitespace-nowrap">
                                  {t('loadStatus.assigned')}
                                </span>
                              )}
                              {col.id === 'PICKED_UP' && (
                                <span className="text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2.5 py-1 rounded-lg font-bold whitespace-nowrap">
                                  {t('loadStatus.picked_up')}
                                </span>
                              )}
                              {col.id === 'ON_ROAD' && load.status !== 'DELIVERED' && (
                                <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                  {t('loadStatus.on_road')}
                                </span>
                              )}
                              {load.status === 'DELIVERED' && (
                                <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                  {t('loads.awaitingCompletion')}
                                </span>
                              )}
                              {load.status === 'COMPLETED' && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenDocs(load);
                                  }}
                                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-mono font-bold transition-colors whitespace-nowrap"
                                >
                                  {t('documents.invoice')}
                                </button>
                              )}
                            </div>
                            )}

                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* 2. Professional Clean Table View */}
      {activeView === 'table' && (
        <div className="space-y-4">
          
          {/* Rate Con AI Drag & Drop Banner */}
          {importDocument && <div
            {...pasteTargetProps}
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOverOffer(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDraggingOverOffer(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOverOffer(false);
              submitDocumentFile(e.dataTransfer.files?.[0]);
            }}
            className={`upload-strip border border-dashed rounded-xl p-4 transition-all flex flex-col sm:flex-row items-center justify-between gap-3 ${
              isDraggingOverOffer
                ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 ring-4 ring-blue-500/20'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-2xs'
            }`}
          >
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100 flex items-center space-x-2">
                  <span>{onAssignedDocumentUpload ? t('loads.addForDriver') : t('loads.createFromDocument')}</span>
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-bold">
                    <Sparkles className="w-3 h-3" />
                    <span>AI</span>
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  {t('loads.dropHint')}
                </p>
              </div>
            </div>

            <label className="cursor-pointer inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 text-xs font-bold transition-colors shadow-2xs flex-shrink-0">
              <UploadCloud className="w-3.5 h-3.5" />
              <span>{t('loads.chooseFile')}</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  submitDocumentFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>}

          <div className="loads-table w-full overflow-x-auto border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider">
              <tr>
                  <th className="py-3.5 px-4">{t('loads.loadNumber')}</th>
                  <th className="py-3.5 px-4">{t('common.status')}</th>
                  <th className="py-3.5 px-4">{t('loads.broker')}</th>
                  <th className="py-3.5 px-4">{t('loads.route')}</th>
                  <th className="py-3.5 px-4">{t('loads.equipment')}</th>
                  <th className="py-3.5 px-4">{t('drivers.driver')}</th>
                  <th className="py-3.5 px-4 text-right">{t('loads.rate')}</th>
                  <th className="py-3.5 px-4 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {visibleLoads.map((load) => {
                const driver = getDriver(load.driverId);
                const stage = allStages.find(s => s.id === load.status);

                return (
                  <tr key={load.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                      {load.loadNumber}
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center space-x-2 text-sm font-semibold">
                        <span className={`w-2.5 h-2.5 rounded-full ${stage?.dot || 'bg-zinc-400'}`} />
                        <span>{stage?.title || load.status}</span>
                      </span>
                    </td>
                    <td className="py-3 px-3 text-zinc-700 dark:text-zinc-300 font-medium">
                      {load.broker || t('inbox.brokerMissing')}
                    </td>
                    <td className="py-3 px-3 font-bold text-zinc-900 dark:text-zinc-100">
                      {load.origin.city || t('common.notProvided')}, {load.origin.state} ➔ {load.destination.city || t('common.notProvided')}, {load.destination.state}
                    </td>
                    <td className="py-3 px-3 text-zinc-500 font-medium text-sm">
                      {load.equipment || t('common.notProvided')}
                    </td>
                    <td className="py-3 px-3 text-zinc-700 dark:text-zinc-300 font-bold">
                      {load.targetDriverIds && load.targetDriverIds.length > 1 && load.status === 'UNASSIGNED' ? (
                        <span className="text-blue-600 dark:text-blue-400">
                          {t('loads.offeredDrivers', { count: load.targetDriverIds.length })}
                        </span>
                      ) : (
                        driver?.name || t('loads.unassigned')
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(load.rate)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {['ready_for_offer', 'offered'].includes(load.databaseStatus) && (
                          <button
                            type="button"
                            onClick={() => onSendOffer?.(load)}
                            className="rounded-lg bg-blue-50 px-3.5 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            {t('loads.assignToDriver')}
                          </button>
                        )}
                        <button
                          onClick={() => onOpenDocs(load)}
                          className="text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 px-3.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors"
                        >
                          {t('nav.documents')}
                        </button>
                        {canDeleteLoad(load) && (
                          <button
                            type="button"
                            onClick={() => setLoadPendingDelete(load)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            aria-label={t(onTrashLoad ? 'loadTrash.moveTitle' : 'loads.deleteNamed', { number: load.loadNumber })}
                            title={t(onTrashLoad ? 'loadTrash.move' : 'loads.deleteTitle')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleLoads.length === 0 && (
                <tr><td colSpan={8} className="empty-table-cell">
                  <TruckEmptyState t={t} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {detailsLoad && (
        <React.Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-white/80 dark:bg-zinc-950/80"><LoaderCircle className="h-7 w-7 animate-spin" aria-label={t('common.loading')} /></div>}>
        <LoadDetailsModal
          load={detailsLoad}
          driver={getDriver(detailsLoad.driverId)}
          onTrashLoad={onTrashLoad}
          onClose={closeLoadDetails}
          onOpenDocs={(load, documentId) => {
            setSelectedLoadDetails(null);
            onOpenDocs(load, documentId);
          }}
        />
        </React.Suspense>
      )}

      {loadPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-load-title"
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
              <Trash2 className="h-5 w-5" />
            </div>
            <h2 id="delete-load-title" className="text-lg font-extrabold text-zinc-950 dark:text-white">
              {t(onTrashLoad ? 'loadTrash.moveTitle' : 'loads.deleteNamed', { number: loadPendingDelete.loadNumber })}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              {t(onTrashLoad ? 'loadTrash.moveWarning' : 'loads.deleteWarning')}
            </p>
            {deleteError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLoadPendingDelete(null)}
                disabled={isDeleting}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                <span>{t(onTrashLoad ? (isDeleting ? 'loadTrash.moving' : 'loadTrash.move') : (isDeleting ? 'loads.deleting' : 'loads.deleteTitle'))}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TruckEmptyState({ t }) {
  return <div className="empty-table-state"><Columns3 size={24} aria-hidden="true" /><strong>{t('loads.empty')}</strong><span>{t('loads.emptyHint')}</span></div>;
}
