import { ArrowUpRight, ChevronLeft, ChevronRight, Download, LoaderCircle, Minus, PanelLeft, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const controlClass = 'rounded p-2 text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-300 disabled:cursor-default disabled:opacity-30';

// Shared chrome for every trip document, including photographed BOL/POD/receipts.
export default function DocumentViewerFrame({
  url, title, pageNumber, pageCount, zoom, onZoomChange, onPageChange,
  sidebarOpen, onSidebarToggle, thumbnailsRef, viewportRef, thumbnails, children, onOpenOriginal,
  onDownload, downloading = false, actionError,
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#262626] text-zinc-100">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-white/10 bg-[#323232] px-3 py-1 text-xs">
        <div className="flex items-center gap-1">
          <button type="button" className={`${controlClass} mr-2`} aria-label={t('documents.pdfThumbnails')} aria-expanded={sidebarOpen} onClick={onSidebarToggle}><PanelLeft className="h-4 w-4" /></button>
          <button type="button" className={controlClass} aria-label={t('documents.previousPage')} disabled={!pageCount || pageNumber === 1} onClick={() => onPageChange(pageNumber - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-24 text-center tabular-nums" aria-live="polite">{pageCount ? t('documents.pdfPage', { page: pageNumber, total: pageCount }) : '—'}</span>
          <button type="button" className={controlClass} aria-label={t('documents.nextPage')} disabled={!pageCount || pageNumber === pageCount} onClick={() => onPageChange(pageNumber + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={controlClass} aria-label={t('documents.zoomOut')} disabled={!pageCount || zoom <= 0.5} onClick={() => onZoomChange(Math.max(0.5, zoom - 0.25))}><Minus className="h-4 w-4" /></button>
          <button type="button" className={`${controlClass} min-w-14 tabular-nums`} title={t('documents.fitWidth')} aria-label={t('documents.fitWidth')} disabled={!pageCount} onClick={() => onZoomChange(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className={controlClass} aria-label={t('documents.zoomIn')} disabled={!pageCount || zoom >= 2.5} onClick={() => onZoomChange(Math.min(2.5, zoom + 0.25))}><Plus className="h-4 w-4" /></button>
        </div>
        {onOpenOriginal ? <button type="button" onClick={onOpenOriginal} className="inline-flex items-center gap-1.5 rounded px-2 py-2 font-medium text-zinc-100 hover:bg-white/10">{t('documents.openOriginal')}<ArrowUpRight className="h-4 w-4" /></button> : <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded px-2 py-2 font-medium text-zinc-100 hover:bg-white/10">{t('documents.openOriginal')}<ArrowUpRight className="h-4 w-4" /></a>}
      </div>
      {onDownload && <div className="flex items-center justify-end gap-3 bg-[#323232] px-3 pb-1 text-xs">
        {actionError && <span role="alert" className="text-red-200">{actionError}</span>}
        <button type="button" onClick={onDownload} disabled={downloading} className={`${controlClass} inline-flex items-center gap-2`}>
          {downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t(downloading ? 'documents.downloading' : 'documents.download')}
        </button>
      </div>}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <nav ref={thumbnailsRef} aria-label={t('documents.pdfThumbnails')} className="relative w-40 shrink-0 overflow-y-auto overscroll-contain border-r border-white/15 px-3 py-6 sm:w-56">{thumbnails}</nav>}
        <div ref={viewportRef} tabIndex={0} className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-300" aria-label={title}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function DocumentThumbnail({ number, total, active, onClick, children }) {
  const { t } = useTranslation();
  return (
    <button type="button" aria-label={t('documents.pdfPage', { page: number, total })} aria-current={active ? 'page' : undefined} onClick={onClick} className="mx-auto mb-7 flex w-fit flex-col items-center gap-2 rounded p-1 focus-visible:outline-2 focus-visible:outline-blue-300">
      <span className={`block border-4 ${active ? 'border-[#8ab4f8]' : 'border-transparent hover:border-white/30'}`}>{children}</span>
      <span className="text-sm tabular-nums">{number}</span>
    </button>
  );
}
