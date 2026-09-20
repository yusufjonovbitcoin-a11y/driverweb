import React, { useState } from 'react';
import { 
  Columns3,
  Table as TableIcon,
  Sparkles,
  UploadCloud
} from 'lucide-react';

const STAGES = [
  { id: 'OFFER', title: 'Takliflar', dot: 'bg-amber-500' },
  { id: 'ASSIGNED', title: 'Tayinlangan', dot: 'bg-blue-500' },
  { id: 'IN_TRANSIT', title: 'Tranzitda', dot: 'bg-purple-500' },
  { id: 'DELIVERED', title: 'Yetkazildi', dot: 'bg-emerald-500' },
  { id: 'COMPLETED', title: 'Tugallangan', dot: 'bg-zinc-400' }
];

export default function KanbanBoard({ 
  loads, 
  drivers, 
  onAdvanceStatus, 
  onOpenDocs, 
  onDropOnOffer
}) {
  const [viewMode, setViewMode] = useState('table');
  const [isDraggingOverOffer, setIsDraggingOverOffer] = useState(false);

  const getDriver = (driverId) => drivers.find(d => d.id === driverId);

  return (
    <div className="space-y-4">
      {/* Subheader: Counter & View Switcher */}
      <div className="flex items-center justify-between">
        <div className="text-base lg:text-lg text-zinc-600 dark:text-zinc-400 font-medium">
          Jami: <strong className="text-zinc-900 dark:text-zinc-100 font-bold">{loads.length} ta reys</strong>
        </div>

        {/* View Toggle */}
        <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1">
          <button
            onClick={() => setViewMode('kanban')}
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
            onClick={() => setViewMode('table')}
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
      </div>

      {/* 1. Kanban View */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 overflow-x-auto pb-4">
          {STAGES.map((col) => {
            const colLoads = loads.filter((l) => l.status === col.id);
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
                    if (file && onDropOnOffer) {
                      onDropOnOffer(file);
                    }
                  }
                }}
                className={`relative bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-200/50 dark:border-zinc-800/50 rounded-2xl p-3 flex flex-col min-w-[240px] min-h-[560px] transition-all ${
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

                {/* Cards / Big Full-Height Drop Target when Offer Column is Empty */}
                <div className="space-y-3 flex-1 flex flex-col overflow-y-auto">
                  {colLoads.length === 0 ? (
                    isOfferCol ? (
                      /* KATTA TO'LIQ DRAG & DROP MAYDONI */
                      <label 
                        className="flex-1 min-h-[400px] border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl flex flex-col items-center justify-center p-5 text-center bg-white/50 dark:bg-zinc-900/40 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 cursor-pointer transition-all group select-none shadow-2xs"
                        title="Surat yoki PDF tashlang — AI yukni avtomatik tayyorlaydi"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 group-hover:scale-110 transition-transform shadow-xs">
                          <UploadCloud className="w-8 h-8" />
                        </div>
                        <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1.5">
                          Surat yoki PDF tashlang
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 max-w-[190px] leading-relaxed mb-4 font-medium">
                          Rate Con surati yoki faylini shu yerga sudrab tashlang
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
                            if (file && onDropOnOffer) {
                              onDropOnOffer(file);
                            }
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
                          className="flex items-center justify-center space-x-2 py-3 px-3.5 rounded-xl border-2 border-dashed border-blue-400/60 dark:border-blue-600/50 hover:border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/20 cursor-pointer text-sm font-bold transition-all shadow-xs group"
                          title="Yana surat yoki PDF tashlang"
                        >
                          <UploadCloud className="w-4 h-4 group-hover:scale-110 transition-transform" />
                          <span>+ Surat/PDF tashlang (AI)</span>
                          <input
                            type="file"
                            accept=".pdf,image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file && onDropOnOffer) {
                                onDropOnOffer(file);
                              }
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
                            <div className="flex items-baseline justify-between">
                              <span className="font-mono font-bold text-sm text-zinc-500 whitespace-nowrap">
                                {load.loadNumber}
                              </span>
                              <span className="font-mono font-extrabold text-base text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                                ${load.rate?.toLocaleString()}
                              </span>
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
                                <button
                                  onClick={() => onAdvanceStatus(load.id, 'ASSIGNED')}
                                  className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-2.5 py-1 rounded-lg font-bold transition-colors whitespace-nowrap"
                                >
                                  Qabul
                                </button>
                              )}
                              {col.id === 'ASSIGNED' && (
                                <button
                                  onClick={() => onAdvanceStatus(load.id, 'IN_TRANSIT')}
                                  className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-2.5 py-1 rounded-lg font-bold transition-colors whitespace-nowrap"
                                >
                                  Ortildi
                                </button>
                              )}
                              {col.id === 'IN_TRANSIT' && (
                                <button
                                  onClick={() => onAdvanceStatus(load.id, 'DELIVERED')}
                                  className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-2.5 py-1 rounded-lg font-bold transition-colors whitespace-nowrap"
                                >
                                  Yetkazildi
                                </button>
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
              if (file && onDropOnOffer) {
                onDropOnOffer(file);
              }
            }}
            className={`border-2 border-dashed rounded-2xl p-4 transition-all flex flex-col sm:flex-row items-center justify-between gap-3 ${
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
                  <span>Yangi yuk qo'shish (AI Rate Con)</span>
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-bold">
                    <Sparkles className="w-3 h-3" />
                    <span>AI</span>
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Rate Con suratini yoki PDF faylini shu yerga tashlang, AI drayver ekraniga moslab tayyorlaydi
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
                  if (file && onDropOnOffer) {
                    onDropOnOffer(file);
                  }
                }}
              />
            </label>
          </div>

          <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
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
              {loads.map((load) => {
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
                      <button
                        onClick={() => onOpenDocs(load)}
                        className="text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 px-3.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors"
                      >
                        Hujjatlar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
