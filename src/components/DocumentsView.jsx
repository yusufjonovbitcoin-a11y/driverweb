import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  FileText, 
  Search, 
  Table as TableIcon, 
  LayoutGrid
} from 'lucide-react';
import { formatCurrency } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';

export default function DocumentsView({ loads, drivers, onOpenDocs }) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewMode, setViewMode] = useState('table'); // sukut bo'yicha flat jadval

  const getDriver = (driverId) => drivers.find(d => d.id === driverId);

  const filteredLoads = loads.filter((load) => {
    const driver = getDriver(load.driverId);
    
    // Status filter
    if (statusFilter !== 'ALL' && load.status !== statusFilter) {
      return false;
    }

    // Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      load.loadNumber.toLowerCase().includes(q) ||
      load.broker?.toLowerCase().includes(q) ||
      load.origin?.city?.toLowerCase().includes(q) ||
      load.destination?.city?.toLowerCase().includes(q) ||
      (driver && driver.name.toLowerCase().includes(q))
    );
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'OFFER':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">{loadStatusLabel(t, status)}</span>;
      case 'ASSIGNED':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">{loadStatusLabel(t, status)}</span>;
      case 'IN_TRANSIT':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800/40">{loadStatusLabel(t, status)}</span>;
      case 'DELIVERED':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">{loadStatusLabel(t, status)}</span>;
      case 'COMPLETED':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700">{loadStatusLabel(t, status)}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="w-full space-y-6 pb-12">
      
      {/* Flat Header — No Card Box */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            {t('documents.title')}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('documents.subtitle')}
          </p>
        </div>

        {/* View Mode Switcher: Jadval vs Kartalar */}
        <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 text-xs font-bold self-start sm:self-auto">
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              viewMode === 'table'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <TableIcon className="w-4 h-4" />
            <span>{t('loads.table')}</span>
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              viewMode === 'cards'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            <span>{t('documents.cards')}</span>
          </button>
        </div>
      </div>

      {/* Subheader: Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('documents.searchPlaceholder')}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
          />
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 text-xs font-bold">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('common.all')} ({loads.length})
          </button>
          <button
            onClick={() => setStatusFilter('IN_TRANSIT')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'IN_TRANSIT'
                ? 'bg-white dark:bg-zinc-800 text-purple-600 dark:text-purple-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('loadStatus.in_transit')}
          </button>
          <button
            onClick={() => setStatusFilter('DELIVERED')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'DELIVERED'
                ? 'bg-white dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('loadStatus.delivered')}
          </button>
        </div>
      </div>

      {/* 1. TABLE VIEW (FLAT ENTERPRISE TABLE — NO FLOATING CARD) */}
      {viewMode === 'table' && (
        <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">{t('documents.tripAndRate')}</th>
                <th className="py-3.5 px-4">{t('loads.route')}</th>
                <th className="py-3.5 px-4">{t('loads.broker')}</th>
                <th className="py-3.5 px-4">{t('drivers.driver')}</th>
                <th className="py-3.5 px-4">{t('documents.documentStatus')}</th>
                <th className="py-3.5 px-4">{t('documents.tripStatus')}</th>
                <th className="py-3.5 px-4 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {filteredLoads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400 font-medium">
                    {t('documents.noDocuments')}
                  </td>
                </tr>
              ) : (
                filteredLoads.map((load) => {
                  const driver = getDriver(load.driverId);
                  const hasRateCon = !!load.documents?.rateCon;
                  const hasBol = !!load.documents?.shipperBol;
                  const hasPod = !!load.documents?.receiverPod;
                  const hasDocumentWarning = Object.values(load.documentChecks || {})
                    .some((review) => ['warning', 'failed_to_read'].includes(review?.check_status));

                  return (
                    <tr key={load.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors">
                      
                      {/* Reys & Stavka */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-mono">
                          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                            {load.loadNumber}
                          </span>
                          <span className="ml-2 font-black text-sm text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(load.rate)}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-400 font-mono mt-0.5">
                          {load.distanceMiles} mi • {load.equipment || t('common.notProvided')}
                        </div>
                      </td>

                      {/* Marshrut */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                          {load.origin?.city || t('common.notProvided')}, {load.origin?.state} ➔ {load.destination?.city || t('common.notProvided')}, {load.destination?.state}
                        </div>
                      </td>

                      {/* Broker */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                          {load.broker || t('inbox.brokerMissing')}
                        </div>
                      </td>

                      {/* Haydovchi */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {driver ? (
                          <div className="flex items-center space-x-2.5">
                            <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-xs text-zinc-700 dark:text-zinc-300 flex-shrink-0">
                              {driver.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                                {driver.name}
                              </div>
                              <div className="text-xs text-zinc-400 font-mono mt-0.5">
                                {driver.driverNumber}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400 italic font-mono">— {t('loads.unassigned')}</span>
                        )}
                      </td>

                      {/* Hujjatlar Holati (Pills) */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${
                            hasRateCon 
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' 
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                          }`} title={hasRateCon ? t('documents.uploaded') : t('documents.waiting')}>
                            RateCon
                          </span>

                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${
                            hasBol 
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40' 
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                          }`} title={hasBol ? t('documents.approved') : t('documents.waiting')}>
                            BOL
                          </span>

                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${
                            hasPod 
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' 
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                          }`} title={hasPod ? t('documents.approved') : t('documents.waiting')}>
                            POD
                          </span>
                          {hasDocumentWarning && (
                            <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                              {t('documents.aiWarning')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Reys Holati */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getStatusBadge(load.status)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => onOpenDocs(load)}
                          className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 font-bold text-xs transition-colors shadow-2xs cursor-pointer"
                          title={t('documents.viewManage')}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{t('loads.view')}</span>
                        </button>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. CARDS VIEW (KARTALAR) */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLoads.map((load) => {
            return (
              <div 
                key={load.id} 
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3.5 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
              >
                {/* Header */}
                <div className="flex items-center justify-between font-mono">
                  <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    {load.loadNumber}
                  </span>
                  <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(load.rate)}
                  </span>
                </div>

                {/* Route */}
                <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  {load.origin?.city || t('common.notProvided')}, {load.origin?.state} ➔ {load.destination?.city || t('common.notProvided')}, {load.destination?.state}
                </div>

                {/* Details */}
                <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                  <span>{load.broker || t('inbox.brokerMissing')}</span>
                  <span>{load.equipment || t('common.notProvided')}</span>
                </div>

                {/* Document Status Pills */}
                <div className="flex items-center space-x-1.5 pt-1">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    load.documents?.rateCon ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                  }`}>
                    RateCon
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    load.documents?.shipperBol ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                  }`}>
                    BOL
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    load.documents?.receiverPod ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                  }`}>
                    POD
                  </span>
                </div>

                {/* Footer with status & button */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <div>{getStatusBadge(load.status)}</div>
                  <button
                    onClick={() => onOpenDocs(load)}
                    className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 font-bold text-xs transition-colors shadow-2xs cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{t('loads.view')}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
