import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  Columns3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Table as TableIcon,
  Sparkles,
  UploadCloud,
  Trash2,
  LoaderCircle,
} from 'lucide-react';

const STAGES = [
  { id: 'OFFER', title: 'Takliflar', dot: 'bg-amber-500' },
  { id: 'ASSIGNED', title: 'Tayinlangan', dot: 'bg-blue-500' },
  { id: 'IN_TRANSIT', title: 'Tranzitda', dot: 'bg-blue-700' },
  { id: 'DELIVERED', title: 'Yetkazildi', dot: 'bg-emerald-500' },
  { id: 'COMPLETED', title: 'Tugallangan', dot: 'bg-zinc-400' }
];

const CALENDAR_DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

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
  onDropOnOffer,
  isAiProcessing = false,
}) {
  const [viewMode, setViewMode] = useState(() => (
    localStorage.getItem('drivex_load_view_mode') === 'kanban' ? 'kanban' : 'table'
  ));
  const [stageFilter, setStageFilter] = useState('ALL');
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
  const [isDeleting, setIsDeleting] = useState(false);
  const calendarPopoverRef = useRef(null);

  const submitOfferFile = useCallback((file) => {
    if (!file || !onDropOnOffer || isAiProcessing) return;
    onDropOnOffer(file);
  }, [isAiProcessing, onDropOnOffer]);

  useEffect(() => {
    if (!isPasteTargetHovered) return undefined;

    const handleClipboardPaste = (event) => {
      const image = getClipboardImage(event.clipboardData);
      if (!image) return;

      event.preventDefault();
      submitOfferFile(image);
    };

    window.addEventListener('paste', handleClipboardPaste);
    return () => window.removeEventListener('paste', handleClipboardPaste);
  }, [isPasteTargetHovered, submitOfferFile]);

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
  const dateFilteredLoads = hasDateFilter
    ? loads.filter((load) => {
      const pickupDate = load.origin?.date?.slice(0, 10);
      const deliveryDate = load.destination?.date?.slice(0, 10) || pickupDate;
      return pickupDate && pickupDate <= filterEnd && deliveryDate >= filterStart;
    })
    : loads;
  const visibleLoads = stageFilter === 'ALL'
    ? dateFilteredLoads
    : dateFilteredLoads.filter((load) => load.status === stageFilter);

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

  const getDriver = (driverId) => drivers.find(d => d.id === driverId);
  const canDeleteLoad = (load) => (
    ['draft', 'review', 'ready_for_offer', 'offered'].includes(load.databaseStatus)
    && !load.currentAssignmentId
  );

  const confirmDelete = async () => {
    if (!loadPendingDelete || !onDeleteLoad || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteLoad(loadPendingDelete);
      setLoadPendingDelete(null);
    } catch {
      // The parent shows the server error and the dialog stays open for retry.
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="loads-workspace space-y-4">
      <div className="stage-filters" aria-label="Yuk holati bo‘yicha filtr">
        {[{ id: 'ALL', title: 'Barcha yuklar', dot: 'bg-zinc-400' }, ...STAGES].map(stage => (
          <button
            key={stage.id}
            type="button"
            aria-pressed={stageFilter === stage.id}
            className={`stage-filter ${stageFilter === stage.id ? 'is-selected' : ''}`}
            onClick={() => setStageFilter(stage.id)}
          >
            <span className="stage-filter-label"><span className={`stage-dot ${stage.dot}`} />{stage.title}</span>
            <strong>{stage.id === 'ALL' ? dateFilteredLoads.length : dateFilteredLoads.filter(load => load.status === stage.id).length}</strong>
          </button>
        ))}
      </div>
      <div className="board-toolbar">
        <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-500">
          <span>{stageFilter === 'ALL' ? 'Barcha reyslar' : STAGES.find(stage => stage.id === stageFilter)?.title} <span className="toolbar-count">{visibleLoads.length}</span></span>
          {hasDateFilter && (
            <span className="truncate text-xs text-zinc-400" title={`Reys sanasi: ${filterStart}${filterStart !== filterEnd ? ` — ${filterEnd}` : ''}`}>
              {filterStart}{filterStart !== filterEnd ? ` — ${filterEnd}` : ''}
            </span>
          )}
        </div>

        <div ref={calendarPopoverRef} className="relative flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1">
            <button
              onClick={() => selectViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Columns3 className="w-4 h-4" />
              <span>Doska</span>
            </button>
            <button
              onClick={() => selectViewMode('table')}
              aria-pressed={viewMode === 'table'}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <TableIcon className="w-4 h-4" />
              <span>Jadval</span>
            </button>
          </div>

          <button
            type="button"
            aria-label="Sana bo‘yicha filtrlash"
            aria-expanded={isDateFilterOpen}
            onClick={() => setIsDateFilterOpen((isOpen) => !isOpen)}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              hasDateFilter
                ? 'border-teal-600 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-300'
                : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
            title="Sana bo‘yicha filtrlash"
          >
            <CalendarDays className="h-5 w-5" />
          </button>

          {isDateFilterOpen && (
            <div className="absolute right-0 top-11 z-30 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Reys sanasi</p>
                <p className="mt-0.5 text-xs leading-5 text-zinc-500">Bir kunni tanlang. Oralig‘i uchun ikkinchi kunni bosing.</p>
              </div>
              <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, -1))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label="Oldingi oy"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, 1))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label="Keyingi oy"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {CALENDAR_DAYS.map((dayName) => (
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
                  Tozalash
                </button>
                <button
                  type="button"
                  onClick={() => setIsDateFilterOpen(false)}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                >
                  Ko‘rish
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 1. Kanban View */}
      {viewMode === 'kanban' && (
        <div className="kanban-columns">
          {STAGES.filter(col => stageFilter === 'ALL' || col.id === stageFilter).map((col) => {
            const colLoads = dateFilteredLoads.filter((l) => l.status === col.id);
            const isOfferCol = col.id === 'OFFER';

            return (
              <div 
                key={col.id} 
                onDragOver={(e) => {
                  if (isOfferCol) {
                    e.preventDefault();
                    setIsDraggingOverOffer(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (isOfferCol) {
                    e.preventDefault();
                    setIsDraggingOverOffer(false);
                  }
                }}
                onDrop={(e) => {
                  if (isOfferCol) {
                    e.preventDefault();
                    setIsDraggingOverOffer(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && onDropOnOffer && !isAiProcessing) {
                      onDropOnOffer(file);
                    }
                  }
                }}
                className={`kanban-column relative bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-200/50 dark:border-zinc-800/50 rounded-2xl p-3 flex flex-col min-w-[240px] min-h-[560px] transition-all ${
                  isOfferCol && isDraggingOverOffer
                    ? 'border-blue-500 ring-4 ring-blue-500/20 bg-blue-50/30 dark:bg-blue-950/40'
                    : ''
                }`}
              >
                {/* Drag-over full column overlay */}
                {isOfferCol && isDraggingOverOffer && (
                  <div className="absolute inset-0 border-3 border-dashed border-blue-500 bg-blue-50/95 dark:bg-zinc-950/95 rounded-2xl flex flex-col items-center justify-center p-6 text-center z-30 pointer-events-none animate-in fade-in duration-100 shadow-2xl">
                    <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xl mb-3 animate-bounce">
                      <UploadCloud className="w-8 h-8" />
                    </div>
                    <span className="text-lg font-bold text-zinc-900 dark:text-white">
                      Surat yoki PDF ni tashlang!
                    </span>
                    <span className="text-sm text-blue-600 dark:text-blue-400 mt-1 font-medium max-w-[220px]">
                      AI avtomatik tayyorlaydi, faqat drayverni tanlaysiz
                    </span>
                  </div>
                )}

                {/* Stage Title */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200 dark:border-zinc-800/60">
                  <div className="flex items-center space-x-2.5">
                    <span className={`w-3 h-3 rounded-full ${col.dot}`} />
                    <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">{col.title}</span>
                  </div>
                  <span className="text-sm font-mono font-bold text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                    {colLoads.length}
                  </span>
                </div>

                {/* Cards / compact upload card when the offer column is empty */}
                <div className="space-y-3 flex-1 flex flex-col overflow-y-auto">
                  {colLoads.length === 0 ? (
                    isOfferCol ? (
                      /* Keep the upload target aligned with a normal load card. */
                      <label 
                        {...pasteTargetProps}
                        tabIndex={0}
                        className="flex-none min-h-[210px] border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center p-4 text-center bg-white/50 dark:bg-zinc-900/40 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 cursor-pointer transition-all group select-none shadow-2xs"
                        title="Surat yoki PDF tashlang yoki rasmni Ctrl+V qiling"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 group-hover:scale-110 transition-transform shadow-xs">
                          <UploadCloud className="w-8 h-8" />
                        </div>
                        <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
                          Surat yoki PDF tashlang
                        </span>
                        <span className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-sm font-bold shadow-xs group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span>Fayl tanlash</span>
                        </span>
                        <input
                          type="file"
                          accept=".pdf,image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            submitOfferFile(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    ) : (
                      <div className="h-32 flex items-center justify-center border border-dashed border-zinc-200 dark:border-zinc-800/50 rounded-xl text-zinc-400 text-sm font-medium">
                        Bo'sh
                      </div>
                    )
                  ) : (
                    <>
                      {/* If cards exist in Takliflar, show top dropzone bar */}
                      {isOfferCol && (
                        <label 
                          {...pasteTargetProps}
                          tabIndex={0}
                          className="flex items-center justify-center space-x-2 py-3 px-3.5 rounded-xl border-2 border-dashed border-blue-400/60 dark:border-blue-600/50 hover:border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/20 cursor-pointer text-sm font-bold transition-all shadow-xs group"
                          title="Yana surat/PDF tashlang yoki rasmni Ctrl+V qiling"
                        >
                          <UploadCloud className="w-4 h-4 group-hover:scale-110 transition-transform" />
                          <span>+ Surat/PDF yoki Ctrl+V (AI)</span>
                          <input
                            type="file"
                            accept=".pdf,image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              submitOfferFile(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}

                      {colLoads.map((load) => {
                        const driver = getDriver(load.driverId);

                        return (
                          <div
                            key={load.id}
                            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl p-3.5 space-y-2.5 transition-colors shadow-xs"
                          >
                            {/* Top Row: Load ID & Rate (No line wraps!) */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-sm text-zinc-500 whitespace-nowrap">
                                {load.loadNumber}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-extrabold text-base text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                                  ${load.rate?.toLocaleString()}
                                </span>
                                {canDeleteLoad(load) && (
                                  <button
                                    type="button"
                                    onClick={() => setLoadPendingDelete(load)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                    aria-label={`${load.loadNumber} yukini o‘chirish`}
                                    title="Yukni o‘chirish"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Route: Clear & Bold (No truncated dots!) */}
                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                              {load.origin.city}, {load.origin.state} ➔ {load.destination.city}, {load.destination.state}
                            </div>

                            {/* Subtitle: Broker & Specs */}
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium flex items-center justify-between">
                              <span className="truncate mr-1">{load.broker}</span>
                              <span className="whitespace-nowrap font-mono">{load.equipment} • {load.distanceMiles}mi</span>
                            </div>

                            {/* Bottom Row: Driver & Action */}
                            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                              {load.targetDriverIds && load.targetDriverIds.length > 1 && load.status === 'OFFER' ? (
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-bold">
                                  {load.targetDriverIds.length} drayverga taklif
                                </span>
                              ) : (
                                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate mr-1">
                                  {driver?.name || 'Tayinlanmagan'}
                                </span>
                              )}

                              {/* Single Action Button */}
                              {col.id === 'OFFER' && (
                                <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg font-bold whitespace-nowrap">
                                  Javob kutilmoqda
                                </span>
                              )}
                              {col.id === 'ASSIGNED' && (
                                <span className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-lg font-bold whitespace-nowrap">
                                  Qabul qilindi
                                </span>
                              )}
                              {col.id === 'IN_TRANSIT' && (
                                <span className="text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2.5 py-1 rounded-lg font-bold whitespace-nowrap">
                                  Driver yo‘lda
                                </span>
                              )}
                              {col.id === 'DELIVERED' && (
                                <button
                                  onClick={() => onOpenDocs(load)}
                                  className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 px-2.5 py-1 rounded-lg font-bold transition-colors whitespace-nowrap"
                                >
                                  Hujjatlar
                                </button>
                              )}
                              {col.id === 'COMPLETED' && (
                                <button
                                  onClick={() => onOpenDocs(load)}
                                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-mono font-bold transition-colors whitespace-nowrap"
                                >
                                  Invoys
                                </button>
                              )}
                            </div>

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
      {viewMode === 'table' && (
        <div className="space-y-4">
          
          {/* Rate Con AI Drag & Drop Banner */}
          <div
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
              const file = e.dataTransfer.files?.[0];
              if (file && onDropOnOffer && !isAiProcessing) {
                onDropOnOffer(file);
              }
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
                  <span>Hujjatdan yuk yaratish</span>
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-bold">
                    <Sparkles className="w-3 h-3" />
                    <span>AI</span>
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Surat yoki PDF tashlang yoki rasmni Ctrl+V qiling. AI taklifni tayyorlaydi.
                </p>
              </div>
            </div>

            <label className="cursor-pointer inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 text-xs font-bold transition-colors shadow-2xs flex-shrink-0">
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Fayl tanlash</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  submitOfferFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          <div className="loads-table w-full overflow-x-auto border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Yuk #</th>
                <th className="py-3.5 px-4">Holat</th>
                <th className="py-3.5 px-4">Broker</th>
                <th className="py-3.5 px-4">Yo'nalish</th>
                <th className="py-3.5 px-4">Texnika</th>
                <th className="py-3.5 px-4">Haydovchi</th>
                <th className="py-3.5 px-4 text-right">Stavka</th>
                <th className="py-3.5 px-4 text-right">Harakat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {visibleLoads.map((load) => {
                const driver = getDriver(load.driverId);
                const stage = STAGES.find(s => s.id === load.status);

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
                      {load.broker}
                    </td>
                    <td className="py-3 px-3 font-bold text-zinc-900 dark:text-zinc-100">
                      {load.origin.city}, {load.origin.state} ➔ {load.destination.city}, {load.destination.state}
                    </td>
                    <td className="py-3 px-3 text-zinc-500 font-medium text-sm">
                      {load.equipment}
                    </td>
                    <td className="py-3 px-3 text-zinc-700 dark:text-zinc-300 font-bold">
                      {load.targetDriverIds && load.targetDriverIds.length > 1 && load.status === 'OFFER' ? (
                        <span className="text-blue-600 dark:text-blue-400">
                          {load.targetDriverIds.length} drayverga taklif
                        </span>
                      ) : (
                        driver?.name || 'Biriktirilmagan'
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      ${load.rate?.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onOpenDocs(load)}
                          className="text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 px-3.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors"
                        >
                          Hujjatlar
                        </button>
                        {canDeleteLoad(load) && (
                          <button
                            type="button"
                            onClick={() => setLoadPendingDelete(load)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            aria-label={`${load.loadNumber} yukini o‘chirish`}
                            title="Yukni o‘chirish"
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
                  <TruckEmptyState />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
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
              {loadPendingDelete.loadNumber} yukini o‘chirish
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              Yuk va unga yuborilgan takliflar o‘chadi. Original yuklangan fayl va audit tarixi saqlanadi.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLoadPendingDelete(null)}
                disabled={isDeleting}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                <span>{isDeleting ? 'O‘chirilmoqda...' : 'Yukni o‘chirish'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TruckEmptyState() {
  return <div className="empty-table-state"><Columns3 size={24} aria-hidden="true" /><strong>Hozircha yuklar yo‘q</strong><span>Yangi yuk yarating yoki boshqa holatni tanlang.</span></div>;
}
