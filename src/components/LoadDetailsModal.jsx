import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, FileDown, FileText, LoaderCircle, MapPin, Truck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDateTime, formatNumber } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';
import { buildLoadDetails } from './loadDetailsModel';

const loadPdfTools = () => import('../services/loadDocumentPdf');

const value = (content) => content ?? '—';

export default function LoadDetailsModal({ load, driver, onClose, onOpenDocs }) {
  const { t } = useTranslation();
  const closeRef = useRef(null);
  const pdfAssetRef = useRef(null);
  const pdfPreparationRef = useRef(null);
  const pdfControllerRef = useRef(null);
  const pdfToolsRef = useRef(null);
  const pdfPreparationVersionRef = useRef(0);
  const [isCombiningPdf, setIsCombiningPdf] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfAsset, setPdfAsset] = useState(null);
  const [combineError, setCombineError] = useState('');
  const details = buildLoadDetails(load, driver);
  const documents = details.documents.map((document) => ({
    ...document,
    title: {
      rateCon: t('documents.brokerRateCon'),
      shipperBol: t('documents.shipperBol'),
      receiverPod: t('documents.receiverPod'),
      receipt: t('documents.paymentReceipt'),
    }[document.id],
  }));
  const documentsSignature = documents.map((document) => `${document.id}:${document.url || ''}`).join('|');

  const prepareCombinedPdf = useCallback(async () => {
    if (pdfAssetRef.current) return pdfAssetRef.current;
    if (pdfPreparationRef.current) return pdfPreparationRef.current;

    const version = pdfPreparationVersionRef.current;
    const controller = new AbortController();
    pdfControllerRef.current = controller;
    setIsCombiningPdf(true);
    setCombineError('');
    const preparation = loadPdfTools().then(async (tools) => {
      if (version !== pdfPreparationVersionRef.current) return null;
      pdfToolsRef.current = tools;
      const result = await tools.createLoadDocumentsPdfFile(load, { signal: controller.signal });
      const dragUrl = await tools.fileAsDataUrl(result.file);
      if (version !== pdfPreparationVersionRef.current) return null;
      const asset = {
        ...result,
        objectUrl: URL.createObjectURL(result.file),
        dragUrl,
      };
      pdfAssetRef.current = asset;
      setPdfAsset(asset);
      return asset;
    });
    pdfPreparationRef.current = preparation;

    try {
      return await preparation;
    } finally {
      if (pdfPreparationRef.current === preparation) pdfPreparationRef.current = null;
      if (pdfControllerRef.current === controller) pdfControllerRef.current = null;
      if (version === pdfPreparationVersionRef.current) setIsCombiningPdf(false);
    }
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    pdfPreparationVersionRef.current += 1;
    pdfControllerRef.current?.abort();
    pdfControllerRef.current = null;
    if (pdfAssetRef.current?.objectUrl) URL.revokeObjectURL(pdfAssetRef.current.objectUrl);
    pdfAssetRef.current = null;
    pdfPreparationRef.current = null;
    // oxlint-disable-next-line react/set-state-in-effect -- a different document set invalidates the prepared drag file.
    setPdfAsset(null);
    setIsCombiningPdf(false);
    setIsDownloadingPdf(false);
    setCombineError('');

    return () => {
      pdfPreparationVersionRef.current += 1;
      pdfControllerRef.current?.abort();
      pdfControllerRef.current = null;
      if (pdfAssetRef.current?.objectUrl) URL.revokeObjectURL(pdfAssetRef.current.objectUrl);
      pdfAssetRef.current = null;
      pdfPreparationRef.current = null;
    };
  }, [load.id, load.loadNumber, documentsSignature]);

  const preparePdfForDrag = () => {
    if (!details.documentCount) return;
    const version = pdfPreparationVersionRef.current;
    void prepareCombinedPdf().catch(() => {
      if (version === pdfPreparationVersionRef.current) setCombineError(t('documents.combinePdfError'));
    });
  };

  const combineDocuments = async () => {
    if (details.documentCount === 0 || isDownloadingPdf) return;
    const version = pdfPreparationVersionRef.current;
    setIsDownloadingPdf(true);
    setCombineError('');
    try {
      const asset = await prepareCombinedPdf();
      if (!asset) return;
      const link = document.createElement('a');
      link.href = asset.objectUrl;
      link.download = asset.file.name;
      link.click();
    } catch (error) {
      if (version === pdfPreparationVersionRef.current && error.name !== 'AbortError') {
        setCombineError(t('documents.combinePdfError'));
      }
    } finally {
      if (version === pdfPreparationVersionRef.current) setIsDownloadingPdf(false);
    }
  };

  const dragCombinedPdf = (event) => {
    const asset = pdfAssetRef.current;
    if (!asset) {
      event.preventDefault();
      preparePdfForDrag();
      return;
    }
    pdfToolsRef.current.setLoadDocumentsPdfDragData(event.dataTransfer, asset.file, asset.dragUrl);
  };

  return (
    <div className="load-details-page fixed inset-0 z-50 overflow-hidden bg-white dark:bg-zinc-950">
      <section role="dialog" aria-modal="true" aria-labelledby="load-details-title" className="flex h-full min-h-0 w-full flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="load-details-title" className="text-lg font-bold text-zinc-900 dark:text-white">{t('loads.detailsTitle')}</h2>
              <span className="rounded-lg bg-zinc-100 px-2 py-1 font-mono text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{details.number}</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-zinc-500">{loadStatusLabel(t, details.status)}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </header>

        <div className="load-details-content">
          <div className="load-details-overview">
          <div className="load-details-stops grid grid-cols-2 gap-3">
            <StopCard marker="A" title={t('inbox.pickup')} stop={details.pickup} t={t} />
            <StopCard marker="B" title={t('inbox.delivery')} stop={details.delivery} t={t} />
          </div>

          <div className="load-details-facts grid grid-cols-3 gap-3">
            <DetailSection title={t('loads.dispatchDetails')}>
              <Fact label={t('drivers.driver')} content={details.driverName || t('loads.unassigned')} />
              <Fact label={t('loads.broker')} content={value(details.broker)} />
              <Fact label={t('profile.contact')} content={value(details.brokerContact)} />
              <Fact label={t('common.phone')} content={value(details.brokerPhone)} />
              <Fact label={t('common.email')} content={value(details.brokerEmail)} />
            </DetailSection>

            <DetailSection title={t('loads.commercialDetails')}>
              <Fact label={t('loads.rate')} content={formatCurrency(details.rate)} strong />
              <Fact label={t('loads.distance')} content={`${formatNumber(details.distanceMiles)} mi`} />
              <Fact label="RPM" content={details.ratePerMile == null ? '—' : `${formatCurrency(details.ratePerMile)}/mi`} />
              <Fact label={t('loads.documents')} content={t('loads.documentCount', { count: details.documentCount })} />
            </DetailSection>

            <DetailSection title={t('loads.cargoDetails')}>
              <Fact label={t('loads.commodity')} content={value(details.commodity)} />
              <Fact label={t('loads.equipment')} content={value(details.equipment)} />
              <Fact label={t('loads.weight')} content={details.weightLbs == null ? '—' : `${formatNumber(details.weightLbs)} lb`} />
              <Fact label={t('loads.temperature')} content={details.temperature == null ? '—' : `${formatNumber(details.temperature)}°F`} />
              <Fact label={t('loads.pallets')} content={formatNumber(details.pallets)} />
              <Fact label={t('loads.cases')} content={formatNumber(details.cases)} />
              <Fact label={t('loads.hazmat')} content={details.isHazmat == null ? '—' : details.isHazmat ? t('common.yes') : t('common.no')} />
            </DetailSection>
          </div>
          </div>

          <InstructionPages key={load.id} instructions={details.specialInstructions} requirements={details.requirements} t={t} />
        </div>

        <footer className="load-details-documents shrink-0 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <DetailSection title={t('loads.documents')}>
            <div className="grid grid-cols-4 gap-3">
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  disabled={!document.url}
                  onClick={() => onOpenDocs(load, document.id)}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/60 disabled:cursor-not-allowed disabled:opacity-55 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-teal-600 dark:hover:bg-teal-950/20"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"><FileText className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{document.title}</span>
                    <span className={`mt-0.5 block text-xs font-semibold ${document.url ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'}`}>{document.url ? t('documents.uploaded') : t('documents.notUploaded')}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3">
              {combineError && <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{combineError}</p>}
              <button
                type="button"
                disabled={isDownloadingPdf || details.documentCount === 0}
                onClick={combineDocuments}
                onPointerEnter={preparePdfForDrag}
                onFocus={preparePdfForDrag}
                draggable={Boolean(pdfAsset)}
                onDragStart={dragCombinedPdf}
                title={pdfAsset ? t('documents.dragPdfHint') : t('documents.combinePdfHint')}
                aria-label={pdfAsset ? t('documents.dragPdfHint') : t('documents.combinePdfHint')}
                className="inline-flex cursor-grab items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-bold text-zinc-700 shadow-sm transition-colors hover:border-teal-400 hover:text-teal-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-teal-600 dark:hover:text-teal-300"
              >
                {isCombiningPdf ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                <span>{isCombiningPdf ? t('documents.combiningPdf') : t('documents.combinePdf')}</span>
              </button>
            </div>
          </DetailSection>
        </footer>

      </section>
    </div>
  );
}

function InstructionPages({ instructions, requirements, t }) {
  const contentRef = useRef(null);
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState({ count: 1, stride: 0 });
  const contentKey = JSON.stringify([instructions, requirements]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;
    const measure = () => {
      const stride = element.getBoundingClientRect().width + 24;
      // scrollWidth is integer-rounded, while CSS columns can have fractional widths.
      const count = Math.max(1, Math.ceil((element.scrollWidth + 24 - 1) / stride));
      setLayout((current) => current.count === count && current.stride === stride ? current : { count, stride });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [contentKey]);

  const activePage = Math.min(page, layout.count - 1);
  return (
    <section className="load-instructions rounded-xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40" aria-label={t('loads.instructionsAndRequirements')}>
      <h3 className="shrink-0 text-xs font-bold uppercase tracking-wide text-zinc-500">{t('loads.instructionsAndRequirements')}</h3>
      <div className="load-instructions-viewport">
        <div ref={contentRef} className="load-instructions-pages text-sm leading-6 text-zinc-700 dark:text-zinc-300" style={{ transform: `translateX(-${activePage * layout.stride}px)` }}>
          {instructions && <p className="mb-4 whitespace-pre-wrap">{instructions}</p>}
          {requirements.length > 0 && <ol className="list-decimal space-y-3 pl-5">{requirements.map((item, index) => <li key={`${index}:${item}`} className="pl-1">{item}</li>)}</ol>}
          {!instructions && requirements.length === 0 && <p className="text-zinc-400">{t('common.notProvided')}</p>}
        </div>
      </div>
      <nav className="flex shrink-0 items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800" aria-label={t('loads.instructionsAndRequirements')}>
        <button type="button" aria-label={t('common.back')} disabled={activePage === 0} onClick={() => setPage(activePage - 1)} className="rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-white disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4" /></button>
        <span aria-live="polite" className="text-xs tabular-nums text-zinc-500">{activePage + 1} / {layout.count}</span>
        <button type="button" aria-label={t('common.next')} disabled={activePage === layout.count - 1} onClick={() => setPage(activePage + 1)} className="rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-white disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"><ChevronRight className="h-4 w-4" /></button>
      </nav>
    </section>
  );
}

function StopCard({ marker, title, stop, t }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black text-white ${marker === 'A' ? 'bg-teal-600' : 'bg-red-500'}`}>{marker}</span><h3 className="font-bold text-zinc-900 dark:text-white">{title}</h3></div>
      <div className="mt-3 space-y-2 text-sm">
        <p className="flex items-start gap-2 font-semibold text-zinc-800 dark:text-zinc-200"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />{value(stop.facility)}</p>
        <p className="flex items-start gap-2 text-zinc-600 dark:text-zinc-300"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />{value(stop.address)}</p>
        <p className="flex items-start gap-2 text-zinc-600 dark:text-zinc-300"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />{stop.appointment ? formatDateTime(stop.appointment) : '—'}</p>
        {(stop.contactName || stop.contactPhone) && <p className="text-xs text-zinc-500">{t('profile.contact')}: {[stop.contactName, stop.contactPhone].filter(Boolean).join(' · ')}</p>}
      </div>
    </section>
  );
}

function DetailSection({ title, children }) {
  return <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"><h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">{title}</h3>{children}</section>;
}

function Fact({ label, content, strong = false }) {
  return <div className="load-detail-fact flex items-start justify-between gap-2 text-sm"><span className="text-zinc-500">{label}</span><span className={`min-w-0 max-w-[60%] text-right break-words text-zinc-800 dark:text-zinc-200 ${strong ? 'font-bold' : 'font-medium'}`}>{content}</span></div>;
}
