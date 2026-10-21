import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, FileText, LoaderCircle, MapPin, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../i18n/format';
import { briefFieldLabel } from '../services/driverBrief';
import ImportRouteMap from './ImportRouteMap';
import ImportReviewPanels from './ImportReviewPanels';
import { buildImportedLoad, canAssignImportedLoad, importedMapState, importedRatePerMile, importedTripRatePerMile, stopAddress, stopScheduleParts } from './importedLoadModel';
import './imported-load-page.css';
import './import-review-tabs.css';
import { useImportContacts } from '../hooks/useImportContacts';
import { canLookupImportedStop, importedStopContact } from '../services/importContacts';
import { usePreviewRoute } from '../hooks/usePreviewRoute';
import { phoneUri } from '../../supabase/functions/_shared/load-enrichment.ts';
import { copyText } from '../services/copyText';

const show = value => value == null || value === '' ? '—' : String(value);
const phoneHref = phoneUri;

export default function ImportedLoadPage({ load, processing, drivers = [], onBack, onRetry, onConfirm, enableMap = true }) {
  const { t } = useTranslation();
  const headingRef = useRef(null);
  const submitRef = useRef(false);
  const [driverId, setDriverId] = useState(load.preferredDriverId || '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const details = buildImportedLoad(load);
  const sourceUrl = load.sourceUrl || load.documents?.rateCon;
  const warningFields = [...new Set([
    ...details.blockingFields, ...(load.review?.warningFields || []),
  ])];
  const selectedDriver = drivers.find(driver => driver.id === driverId);
  const mapState = importedMapState(details, selectedDriver, now);
  const contactsEnabled = Boolean((load.id || load.previewTicket) && !processing && !load.importError
    && details.stops.some(canLookupImportedStop));
  const contacts = useImportContacts(load.id, load.previewTicket, contactsEnabled);
  const previewEnabled = Boolean((load.previewTicket || load.id) && !processing && !load.importError && enableMap && mapState.routeEnabled);
  const preview = usePreviewRoute(details.stops.map(stop => stop.address ? stopAddress(stop) : ''), driverId, mapState.livePosition, previewEnabled, mapState.observedAt);
  const routeState = preview.route;
  const road = routeState?.data;
  const ratePerMile = importedRatePerMile(details, road);
  const target = road?.targets?.find(item => item.driverId === driverId);
  const tripRatePerMile = importedTripRatePerMile(details, road, target);
  const routeStatusKey = !previewEnabled ? 'loadImport.routeUnavailable' : !routeState ? 'loadImport.routeLoading' : routeState.error ? 'loadImport.routeError'
    : target?.status === 'gps_unavailable' ? 'loadImport.noDriverLocation'
      : target?.status === 'route_unavailable' ? 'loadImport.routeError' : !driverId ? 'loadImport.selectDriverLocation' : null;
  const eligible = !load.existingFinalizedLoadId && canAssignImportedLoad(load, driverId, drivers, processing || submitting);
  useEffect(() => { headingRef.current?.focus(); }, []);

  async function assign(event) {
    event.preventDefault();
    if (!eligible || submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true); setSubmitError('');
    try {
      const result = await onConfirm([driverId]);
      if (result !== true) setSubmitError(typeof result === 'string' ? result : t('errors.createLoad'));
    } catch {
      setSubmitError(t('errors.createLoad'));
    } finally {
      submitRef.current = false; setSubmitting(false);
    }
  }

  return <section className="import-load-page import-workspace" aria-labelledby="import-load-title" aria-busy={processing}>
    {processing ? <div className="import-processing" role="status">
      <div className="import-scan-icon"><FileText size={30} /><LoaderCircle className="animate-spin" size={19} /></div>
      <h1 ref={headingRef} tabIndex={-1} id="import-load-title">{t('loadImport.processing')}</h1>
      <p>{t('loadImport.processingHint')}</p>
      <div className="import-skeleton-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div className="import-skeleton" key={i} />)}</div>
    </div> : load.importError ? <div className="import-error" role="alert">
      <h1 ref={headingRef} tabIndex={-1} id="import-load-title">{t('errors.documentAnalysis')}</h1>
      <p>{load.importError}</p>
      <button className="import-button primary" onClick={onRetry}>{t('loadImport.retry')}</button>
    </div> : <>
      <div className="review-page-heading">
        <div><div className="review-title-line"><h1 ref={headingRef} tabIndex={-1} id="import-load-title">{t('loads.loadNumber')} <span>{details.number ? `#${String(details.number).replace(/^#/, '')}` : '—'}</span></h1>
          <span className={`import-status${load.review?.required ? ' needs-review' : ''}`}><span />{t(load.review?.required ? 'loadImport.needsReview' : 'loadImport.prepared')}</span></div>
          <p className="review-heading-file"><FileText size={15} />{load.fileName || load.driverBrief?.sourceFileName || t('documents.brokerRateCon')}</p></div>
        <div className="review-heading-actions"><div className="import-total"><strong>{formatCurrency(details.rate)}</strong><span>{t('loads.rate')}</span></div>
        {sourceUrl && <a className="import-button" href={sourceUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={17} />{t('driverBrief.original')}</a>}</div>
      </div>
      <ImportReviewPanels load={load} details={details} selectedDriver={selectedDriver} road={road} ratePerMile={ratePerMile}
        stops={<div className="import-stops">
            {details.stops.map((stop, index) => <Stop key={index} number={index + 1}
              title={t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')}
              stop={importedStopContact(stop, contacts, contactsEnabled)}
              referenceLabel={stop.role === 'pickup' ? 'PU#' : 'DEL#'} t={t} />)}
          </div>}
        map={<ImportRouteMap stops={details.stops} addresses={details.stops.map(stop => stop.address ? stopAddress(stop) : '')} enabled={enableMap && mapState.routeEnabled}
            pickup={details.pickup.address ? stopAddress(details.pickup) : ''}
            delivery={details.delivery.address ? stopAddress(details.delivery) : ''}
            driverId={driverId} driverName={selectedDriver?.name} roadRoute={previewEnabled ? routeState : { error: true }}
            livePosition={target?.status === 'ready' ? { lat: target.originLatitude, lng: target.originLongitude } : null} />}
        roadSummary={<div className="import-road-summary" aria-live="polite">
            <div><span>{t('map.pickupFromLatest')}</span><strong>{target?.deadheadMiles == null ? '—' : `${formatNumber(target.deadheadMiles)} mi`}</strong></div>
            <div><span>{t('loadImport.route')}</span><strong>{road?.loadedMiles == null ? '—' : `${formatNumber(road.loadedMiles)} mi`}</strong></div>
            <div><span>{t('loadImport.totalMiles')}</span><strong>{target?.totalMiles == null ? '—' : `${formatNumber(target.totalMiles)} mi`}</strong></div>
            <div><span>{t(tripRatePerMile.source === 'loaded' ? 'loadImport.loadedRouteRpm' : 'loadImport.effectiveRpm')}</span><strong>{tripRatePerMile.value == null ? '—' : `${formatCurrency(tripRatePerMile.value)}/mi`}</strong></div>
            {routeStatusKey && <p>{t(routeStatusKey)}
              {routeState?.error && <> {' '}<button type="button" onClick={preview.retry}>{t('loadImport.retry')}</button></>}
            </p>}
          </div>}
      />
      <form className={`import-assignment${load.preferredDriverId ? ' import-assignment-fixed' : ''}`} onSubmit={assign}>
            {warningFields.length > 0 && <details className="import-review-warning"><summary>{t('driverBrief.warning')}</summary><p>{warningFields.map(key => briefFieldLabel(t, key)).join(', ')}</p></details>}
            {!load.preferredDriverId && <label className="import-driver-select">{t('loads.selectDriver')}
              <select value={driverId} onChange={event => setDriverId(event.target.value)} disabled={submitting}>
                <option value="">{t('loads.selectDriver')}</option>
                {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}{driver.truck ? ` · ${driver.truck}` : ''}</option>)}
              </select>
            </label>}
            {load.existingFinalizedLoadId && <p role="alert" className="import-blocked">{t('importReview.duplicateLoad')}</p>}
            {submitError && <p role="alert" className="import-blocked">{submitError}</p>}
            <div className="import-actions">
              <button type="button" className="import-button" onClick={onBack} disabled={submitting}>{t('loadImport.back')}</button>
              <button type="submit" className="import-button primary" disabled={!eligible}>{submitting ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={19} />}{t('loadImport.assign')}</button>
            </div>
          </form>
    </>}
  </section>;
}

function Stop({ number, title, stop, referenceLabel, t }) {
  const address = stopAddress(stop);
  const [copyResult, setCopyResult] = useState(null);
  const copyTimer = useRef(null);
  const copyAttempt = useRef(0);
  const copyStatus = copyResult?.address === address ? copyResult.status : null;
  useEffect(() => () => {
    copyAttempt.current += 1;
    clearTimeout(copyTimer.current);
  }, [address]);
  async function copyAddress() {
    const attempt = ++copyAttempt.current;
    clearTimeout(copyTimer.current);
    let status;
    try { await copyText(address); status = 'copied'; }
    catch { status = 'error'; }
    if (attempt !== copyAttempt.current) return;
    setCopyResult({ address, status });
    copyTimer.current = setTimeout(() => setCopyResult(null), 2500);
  }
  return <section className={`import-stop stop-${stop.role}`}>
    <span className="import-stop-number">{number}</span>
    <div className="import-stop-title"><h2>{title}</h2><span>{stopScheduleParts(stop).map(([kind, value]) => kind === 'ready'
      ? `${t('loadImport.readyDate')}: ${value}` : kind === 'hours' ? `${t('loadImport.hours')}: ${value}` : value).join('\n')}</span></div>
    <div className="import-stop-content">
      <div><h3>{address ? <button type="button" className="import-stop-address" onClick={copyAddress}
        title={t(copyStatus === 'copied' ? 'loadImport.addressCopied' : 'loadImport.copyAddress')}
        aria-label={`${t('loadImport.copyAddress')}: ${address}`}>
        {copyStatus === 'copied' ? <Check size={19} className="import-copy-success" aria-hidden="true" /> : <MapPin size={19} aria-hidden="true" />}<span>{address}</span>
      </button> : <><MapPin size={19} />{show(address)}</>}</h3>
        <span className={copyStatus === 'error' ? 'import-copy-error' : 'sr-only'} role="status">{copyStatus === 'copied' ? t('loadImport.addressCopied') : copyStatus === 'error' ? t('loadImport.copyAddressError') : ''}</span>
        {stop.facility && <p>{stop.facility}</p>}<p className="import-stop-ref"><FileText size={15} />{referenceLabel} {show(stop.reference)}</p>{stop.appointmentReference && <p>Appt #: {stop.appointmentReference}</p>}{stop.orderReferences && <p>REF: {stop.orderReferences}</p>}{stop.contact && <p>{stop.contact}</p>}</div>
      <div className="import-stop-actions">
        {stop.phone ? <a className="import-button" href={phoneHref(stop.phone)}><Phone size={15} />{stop.phone}</a> : <span className="import-button muted"><Phone size={15} />{t(stop.contactPending ? 'loadImport.contactLoading' : stop.contactError ? 'loadImport.contactError' : 'loadImport.contactMissing')}</span>}
        {stop.address && <a className="import-button" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer"><MapPin size={15} />{t('loadImport.openMap')}<ArrowUpRight size={13} /></a>}
      </div>
    </div>
    {stop.note && <p className="import-stop-note">{stop.note}</p>}
  </section>;
}
