import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FileDown, FileText, LoaderCircle, MapPin, Phone, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatAppointment, formatCurrency, formatNumber } from '../i18n/format';
import { loadStageIndex } from './mapLoadStatsModel';
import { loadStatusLabel } from '../i18n/labels';
import { buildLoadDetails, savedLoadRoadSummary, savedStopContact } from './loadDetailsModel';
import LoadDocumentsManager from './LoadDocumentsManager.jsx';
import LoadTrashAction from './LoadTrashAction.jsx';
import DriverInstructionsEditor from './DriverInstructionsEditor.jsx';
import AssignmentDriverPay from './AssignmentDriverPay.jsx';
import { useLoadCurrentLocation } from '../hooks/useLoadCurrentLocation';
import { useImportContacts } from '../hooks/useImportContacts';
import { useFleetRoute } from '../hooks/useFleetRoute';
import { loadMapStops } from './fleetMapModel';
import ImportReviewPanels from './ImportReviewPanels.jsx';
import { savedLoadReviewDetails } from './savedLoadReviewModel.js';
import { buildImportedLoad, stopAddress, stopScheduleParts as importedScheduleParts } from './importedLoadModel';
import './imported-load-page.css';
import './loadDetails.css';
import './import-review-tabs.css';
import './saved-load-review.css';

const LoadDetailsMap = lazy(() => import('./LoadDetailsMap.jsx'));

const loadPdfTools = () => import('../services/loadDocumentPdf');

const value = (content) => content ?? '—';

export default function LoadDetailsModal({ load, driver, onClose, onOpenDocs, onTrashLoad, onManageDocument }) {
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
  const [documentSnapshot, setDocumentSnapshot] = useState(null);
  const documentContext = documentSnapshot?.loadId === load.id ? documentSnapshot.context : null;
  const receiveDocumentContext = useCallback(context => setDocumentSnapshot({ loadId: load.id, context }), [load.id]);
  const documentCount = documentContext?.documentItems.filter(row => row.current_version_id || row.url).length || 0;
  const details = buildLoadDetails(load, driver);
  const { location, pickupRoute } = useLoadCurrentLocation(load, driver);
  const routeStops = loadMapStops(load);
  const roadRoute = useFleetRoute(routeStops, true, true, load.id);
  const road = savedLoadRoadSummary(load.rateKnown === false ? null : details.rate, roadRoute.route, pickupRoute.route, Boolean(location));
  const routeFailed = roadRoute.route?.error || roadRoute.route?.data?.routingFailed
    || (location && (pickupRoute.route?.error || pickupRoute.route?.data?.routingFailed));
  const savedContacts = useImportContacts(load.id, null, Boolean(load.id));
  const extracted = buildImportedLoad(load);
  const documents = details.documents.map((document) => ({
    ...document,
    versionId: load.documentMeta?.[document.id]?.current_version_id,
    mimeType: load.documentMeta?.[document.id]?.mimeType,
    fileName: load.documentMeta?.[document.id]?.fileName,
    documentId: load.documentMeta?.[document.id]?.id,
    stopId: load.documentMeta?.[document.id]?.stop_id ?? null,
    title: {
      rateCon: t('documents.brokerRateCon'),
      shipperBol: t('documents.shipperBol'),
      receiverPod: t('documents.receiverPod'),
      receipt: t('documents.paymentReceipt'),
    }[document.id],
  }));
  const documentsSignature = JSON.stringify([documents.map(document => [document.id, document.versionId || document.url]),
    load.documentItems?.map(row => [row.id, row.current_version_id]),
    documentContext?.documentItems.map(row => [row.id, row.current_version_id])]);

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
      const result = await tools.createLoadDocumentsPdfFile(documentContext ? { ...load, ...documentContext } : load, { signal: controller.signal });
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
  }, [load, documentContext]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const host = document.querySelector('.workspace-main');
    const background = [...(host?.children || [])].filter(element => !element.classList.contains('load-command-page'));
    const inertState = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    closeRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.target?.closest?.('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      background.forEach((element, index) => { element.inert = inertState[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
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
    if (!documentCount) return;
    const version = pdfPreparationVersionRef.current;
    void prepareCombinedPdf().catch(() => {
      if (version === pdfPreparationVersionRef.current) setCombineError(t('documents.combinePdfError'));
    });
  };

  const combineDocuments = async () => {
    if (documentCount === 0 || isDownloadingPdf) return;
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

  const requirementsContent = <>
    {onTrashLoad && !load.trashedAt && <DriverInstructionsEditor key={load.id} loadId={load.id} />}
  </>;

  const documentsContent = active => (
            <footer className="load-details-documents load-command-documents is-document-workspace">
            <LoadDocumentsManager key={load.id} load={load} documents={documents} onOpenDocs={onOpenDocs} onManageDocument={onManageDocument}
              variant="workspace" active={active} notice={combineError} onContextChange={receiveDocumentContext} actions={busy => <button
                type="button"
                disabled={busy || isDownloadingPdf || documentCount === 0}
                onClick={combineDocuments}
                draggable={Boolean(pdfAsset)}
                onDragStart={dragCombinedPdf}
                title={pdfAsset ? t('documents.dragPdfHint') : t('documents.combinePdfHint')}
                aria-label={pdfAsset ? t('documents.dragPdfHint') : t('documents.combinePdfHint')}
                className="is-primary"
              >
                {isCombiningPdf ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                <span>{isCombiningPdf ? t('documents.combiningPdf') : t('documentWorkspace.combinePdf')}</span>
              </button>} />
            </footer>
  );

  const stage = loadStageIndex(load);
  const reviewDetails = savedLoadReviewDetails(load, details, extracted);
  reviewDetails.stops = reviewDetails.stops.map((stop, index) => {
    const matched = matchingExtractedStop(stop, index, details.stops, extracted.stops);
    const schedule = stopScheduleParts(stop);
    const savedSchedule = [schedule.date, schedule.time].filter(Boolean);
    return { ...stop, scheduleLines: savedSchedule.length ? savedSchedule : matched
      ? importedScheduleParts(matched).map(([kind, content]) => kind === 'hours' ? `${t('loadImport.hours')}: ${content}` : content)
      : [] };
  });
  const overviewContent = <div className="saved-review-overview">
    <section className="reference-progress reference-card" aria-label={t('loads.stageProgress')}>
      {['assigned', 'in_progress', 'delivered', 'completed'].map((status, index) => <div key={status} className={`${stage != null && index <= stage ? 'is-complete' : ''} ${stage === index ? 'is-current' : ''}`} aria-current={stage === index ? 'step' : undefined}>
        <span className="reference-progress-dot">{stage != null && index < stage ? <Check size={12} /> : null}</span><span>{loadStatusLabel(t, status)}</span>
      </div>)}
    </section>
    {load.currentAssignmentId && load.driverId ? <AssignmentDriverPay assignmentId={load.currentAssignmentId} loadId={load.id} driverId={load.driverId} /> : null}
  </div>;
  const stopsContent = <div className="saved-review-stops" data-load-section="stops" tabIndex={-1}>
    {details.stops.map((stop, index) => {
      const contact = savedStopContact(details.stops, index, savedContacts?.data?.contacts);
      return <StopCard key={stop.stopId || index} marker={stop.markerLabel} title={t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')}
        stop={{ ...stop, contactPhone: contact?.phone || stop.contactPhone, phoneSource: contact?.source }}
        extracted={matchingExtractedStop(stop, index, details.stops, extracted.stops)} t={t} />;
    })}
    {(savedContacts?.error || savedContacts?.data?.providerError) && <p className="import-copy-error" role="status">{t('loadImport.contactError')} <button type="button" className="import-button" onClick={savedContacts.retry}>{t('map.retry')}</button></p>}
  </div>;
  const map = <div className="saved-review-map" data-load-section="tracking">
    {location && <span className={`reference-location-status ${location.stale ? 'is-stale' : ''}`}>{t(location.stale ? 'map.locationStale' : 'map.locationFresh')}</span>}
    <Suspense fallback={<div className="load-command-map-loading" role="status">{t('common.loading')}</div>}><LoadDetailsMap load={load} driver={driver} location={location} pickupRoute={pickupRoute} roadRoute={roadRoute} stops={routeStops} /></Suspense>
  </div>;
  const roadSummary = <section className="import-road-summary" aria-label={t('loadImport.route')} aria-live="polite">
    <div><span>{t('map.pickupFromLatest')}</span><strong>{pickupRoute.loading ? '…' : road.deadheadMiles == null ? '—' : `${formatNumber(road.deadheadMiles)} mi`}</strong></div>
    <div><span>{t('loadImport.route')}</span><strong>{roadRoute.loading ? '…' : road.loadedMiles == null ? '—' : `${formatNumber(road.loadedMiles)} mi`}</strong></div>
    <div><span>{t('loadImport.totalMiles')}</span><strong>{road.totalMiles == null ? '—' : `${formatNumber(road.totalMiles)} mi`}</strong></div>
    <div><span>{t('loadImport.effectiveRpm')}</span><strong>{road.ratePerMile == null ? '—' : `${formatCurrency(road.ratePerMile)}/mi`}</strong></div>
    {!location && <p>{t('loadImport.noDriverLocation')}</p>}
    {routeFailed && <p role="status">{t('map.roadUnavailable')} <button type="button" onClick={() => { roadRoute.retry(); pickupRoute.retry(); }}>{t('map.retry')}</button></p>}
  </section>;
  const page = <div className="load-details-page load-command-page saved-review-page">
    <section role="dialog" aria-labelledby="load-details-title" className="import-load-page import-workspace saved-load-workspace">
      <header className="review-page-heading saved-review-heading">
        <div className="saved-review-heading-copy"><div className="review-title-line">
          <button ref={closeRef} type="button" className="saved-review-back" onClick={onClose} aria-label={t('loadImport.back')} title={t('loadImport.back')}><ArrowLeft size={18} /></button>
          <h2 id="load-details-title">{t('loads.loadNumber')} {details.number}</h2>
          <span className={`reference-status${stage == null ? ' is-neutral' : ''}`}>{loadStatusLabel(t, details.status)}</span>
        </div><p className="review-heading-file"><FileText size={15} />{load.driverBrief?.sourceFileName || load.documentMeta?.rateCon?.fileName || t('documents.brokerRateCon')}</p></div>
        <div className="review-heading-actions">
          <div className="import-total"><strong>{formatCurrency(reviewDetails.rate)}</strong><span>{t('loads.rate')}</span></div>
          <LoadTrashAction load={load} onTrashLoad={onTrashLoad} />
        </div>
      </header>
      <ImportReviewPanels key={load.id} load={load} details={reviewDetails} selectedDriver={driver} keepMounted
        stops={stopsContent} map={map} roadSummary={roadSummary} road={road}
        showRouteFacts={false}
        overviewContent={overviewContent} requirementsContent={requirementsContent} documentsContent={documentsContent}
        sourceNoteKey="savedLoadWorkspace.sourceNote" />
    </section>
  </div>;
  const host = typeof document !== 'undefined' && document.querySelector('.workspace-main');
  return host ? createPortal(page, host) : page;
}

function stopScheduleParts(stop) {
  if (!stop) return { date: null, time: null };
  const isInstant = typeof stop.appointment === 'string'
    && /[T\s]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(stop.appointment);
  const date = stop.scheduleDate || (stop.appointment
    ? isInstant ? formatAppointment(stop.appointment, stop.timezone, { dateOnly: true }).split(' · ')[0]
      : formatAppointment(stop.appointment, stop.timezone)
    : null);
  const time = stop.scheduleTime || (isInstant
    ? formatAppointment(stop.appointment, stop.timezone, { timeOnly: true }) : null);
  return { date, time };
}

// Only enrich the canonical route when the snapshot describes the same stops.
// Legacy briefs can contain just two endpoints for a multi-stop saved route.
function matchingExtractedStop(stop, index, routeStops, extractedStops) {
  if (routeStops.length !== extractedStops.length) return null;
  const candidate = extractedStops[index];
  if (!candidate || candidate.role !== stop.role) return null;
  const normalize = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const address = normalize(stop.address);
  if (!address || ![candidate.address, stopAddress(candidate)].some(text => normalize(text) === address)) return null;
  return candidate;
}

function StopCard({ marker, title, stop, extracted, t }) {
  const { date, time } = stopScheduleParts(stop);
  const address = stop.address;
  const savedSchedule = [date, time].filter(Boolean).join('\n');
  const schedule = savedSchedule || (extracted ? importedScheduleParts(extracted).map(([kind, content]) => kind === 'hours' ? `${t('loadImport.hours')}: ${content}` : content).join('\n') : '');
  const phone = stop.contactPhone;
  const reference = stop.reference;
  const appointmentReference = stop.appointmentReference;
  const orderReferences = stop.orderReferences;
  const note = stop.note;
  return <section className={`reference-stop stop-${stop.role}`}>
    <div className="reference-stop-kind"><span className="reference-stop-marker">{marker}</span><strong>{title}</strong></div>
    <div className="reference-stop-schedule">{schedule || [date, time].filter(Boolean).join('\n') || '—'}</div>
    <div className="reference-stop-details"><h4>{value(stop.facility)}</h4><p className="reference-stop-address">{value(address)}</p>
      <div className="reference-stop-meta"><div><p><FileText size={13} />{stop.role === 'pickup' ? 'PU#' : 'DEL#'} {value(reference)}</p>{appointmentReference && <p><FileText size={13} />Appt #: {appointmentReference}</p>}{orderReferences && <p><FileText size={13} />REF: {orderReferences}</p>}</div>
        <div className="reference-stop-contact">{stop.contactName && <strong>{stop.contactName}</strong>}{phone && <a href={`tel:${phone}`}><Phone size={13} />{phone}</a>}{phone && stop.phoneSource === 'google_places' && <a className="reference-phone-source" href="https://maps.google.com" target="_blank" rel="noreferrer">Google Maps</a>}</div>
      </div>
      {note && <p className="reference-stop-note">{note}</p>}
    </div>
    <div className="reference-stop-actions">{address && <a className="import-button" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer"><MapPin size={13} />{t('loadImport.openMap')}</a>}</div>
  </section>;

}
