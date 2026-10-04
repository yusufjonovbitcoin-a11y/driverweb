import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, FileText, LoaderCircle, MapPin, Package, Phone, Route, Thermometer, Truck, Weight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../i18n/format';
import { briefFieldLabel } from '../services/driverBrief';
import ImportRouteMap from './ImportRouteMap';
import ImportDocumentDetails from './ImportDocumentDetails';
import { buildImportedLoad, canAssignImportedLoad, importedMapState, importedRatePerMile, importedTripRatePerMile, stopAddress, stopScheduleParts } from './importedLoadModel';
import './imported-load-page.css';
import { useImportEnrichment } from '../hooks/useImportEnrichment';
import { usePreviewRoute } from '../hooks/usePreviewRoute';
import { validPhone, phoneUri } from '../../supabase/functions/_shared/load-enrichment.ts';

const show = value => value == null || value === '' ? '—' : String(value);
const phoneHref = phoneUri;

export default function ImportedLoadPage({ load, processing, drivers = [], onBack, onRetry, onConfirm, enableMap = true }) {
  const { t } = useTranslation();
  const headingRef = useRef(null);
  const submitRef = useRef(false);
  const [driverId, setDriverId] = useState(load.preferredDriverId || '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const details = buildImportedLoad(load);
  const sourceUrl = load.sourceUrl || load.documents?.rateCon;
  const warningFields = [...new Set([
    ...details.blockingFields, ...(load.review?.warningFields || []),
  ])];
  const selectedDriver = drivers.find(driver => driver.id === driverId);
  const mapState = importedMapState(details, selectedDriver);
  const enrichmentEnabled = Boolean(load.id && !processing && !load.importError && enableMap && mapState.routeEnabled);
  const enrichment = useImportEnrichment(load.id, driverId, enrichmentEnabled);
  const previewEnabled = Boolean(load.previewTicket && !load.id && !processing && !load.importError && enableMap && mapState.routeEnabled);
  const preview = usePreviewRoute(details.stops.map(stop => stop.address ? stopAddress(stop) : ''), driverId, mapState.livePosition, previewEnabled);
  const routeState = load.previewTicket ? preview.route : enrichment.route;
  const road = routeState?.data;
  const ratePerMile = importedRatePerMile(details, road);
  const target = road?.targets?.find(item => item.driverId === driverId);
  const tripRatePerMile = importedTripRatePerMile(details, road, target);
  const enrichStop = (stop, role) => {
    const contact = role ? enrichment.contacts?.data?.contacts?.find(item => item.role === role) : null;
    return { ...stop, phone: stop.phone || (contact?.status === 'found' ? validPhone(contact.phone) : null),
      contactPending: Boolean(role && enrichmentEnabled && !stop.phone && !enrichment.contacts),
      contactError: !stop.phone && (enrichment.contacts?.error || contact?.status === 'provider_error') };
  };
  const eligible = canAssignImportedLoad(load, driverId, drivers, processing || submitting);
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

  return <section className="import-load-page" aria-labelledby="import-load-title" aria-busy={processing}>
    <div className="import-page-toolbar">
      <button className="import-back" onClick={onBack} disabled={submitting}><ArrowLeft size={16} />{t('loadImport.back')}</button>
      <span className="import-filename"><FileText size={15} /><span>{load.fileName || load.driverBrief?.sourceFileName}</span></span>
      {sourceUrl && <a className="import-button" href={sourceUrl} target="_blank" rel="noreferrer"><FileText size={15} />{t('driverBrief.original')}<ArrowUpRight size={14} /></a>}
    </div>

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
      <div className="import-page-grid">
        <article className="import-card import-main-card">
          <div className="import-main-content">
          <div className="import-load-heading">
            <div>
              <span className="import-status"><span />{t(load.review?.required ? 'loadImport.needsReview' : 'loadImport.prepared')}</span>
              <h1 ref={headingRef} tabIndex={-1} id="import-load-title">{t('loads.loadNumber')} <span>{details.number ? `#${String(details.number).replace(/^#/, '')}` : '—'}</span></h1>
              {details.bolNumber && <p className="import-references">BOL# {details.bolNumber}</p>}
            </div>
            <div className="import-total"><strong>{formatCurrency(details.rate)}</strong><span>{t('loads.rate')}</span></div>
          </div>
          <div className="import-chips">
            {details.equipment && <span><Truck size={15} />{details.equipment}</span>}
            {details.temperature != null && <span className="temperature"><Thermometer size={15} />{formatNumber(details.temperature)}°F</span>}
            {details.cargo && <span><Package size={15} />{details.cargo}</span>}
            {details.hazmat != null && <span>{t('loads.hazmat')}: {t(details.hazmat ? 'common.yes' : 'common.no')}</span>}
          </div>
          <div className="import-metrics">
            <Metric icon={Route} label={t('loadImport.documentMiles')} value={details.distance == null ? '—' : `${formatNumber(details.distance)} mi`} />
            <Metric icon={Weight} label={t('loads.weight')} value={details.weight == null ? details.weightPrinted || '—' : `${formatNumber(details.weight)} lb`} />
            <Metric icon={Package} label={t('loads.pallets')} value={formatNumber(details.pallets)} />
            <Metric icon={Route} label={t(ratePerMile.source === 'route'
              ? 'loadImport.estimatedRpm' : 'loadImport.documentRpm')}
              value={ratePerMile.value == null ? '—' : `${formatCurrency(ratePerMile.value)}/mi`} />
          </div>
          <div className="import-stops">
            {details.stops.map((stop, index) => <Stop key={index} number={index + 1}
              title={t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')}
              stop={enrichStop(stop, index === 0 ? 'pickup' : index === details.stops.length - 1 ? 'delivery' : null)}
              referenceLabel={stop.role === 'pickup' ? 'PU#' : 'DEL#'} t={t} />)}
          </div>
          <div className="import-road-summary" aria-live="polite">
            <div><span>{t('loadImport.toPickup')}</span><strong>{target?.deadheadMiles == null ? '—' : `${formatNumber(target.deadheadMiles)} mi`}</strong></div>
            <div><span>{t('loadImport.route')}</span><strong>{road?.loadedMiles == null ? '—' : `${formatNumber(road.loadedMiles)} mi`}</strong></div>
            <div><span>{t('loadImport.totalMiles')}</span><strong>{target?.totalMiles == null ? '—' : `${formatNumber(target.totalMiles)} mi`}</strong></div>
            <div><span>{t(tripRatePerMile.source === 'loaded' ? 'loadImport.loadedRouteRpm' : 'loadImport.effectiveRpm')}</span><strong>{tripRatePerMile.value == null ? '—' : `${formatCurrency(tripRatePerMile.value)}/mi`}</strong></div>
            <p>{!mapState.routeEnabled ? t('loadImport.routeUnavailable') : !routeState ? t('loadImport.routeLoading') : routeState.error ? t('loadImport.routeError')
              : target?.status === 'gps_unavailable' ? t('loadImport.noDriverLocation')
                : target?.status === 'route_unavailable' ? t('loadImport.routeError') : !driverId ? t('loadImport.selectDriverLocation') : t('loadImport.roadEstimate')}
              {routeState?.error && <> {' '}<button type="button" onClick={load.previewTicket ? preview.retry : enrichment.retry}>{t('loadImport.retry')}</button></>}
              {road && <> · <a href={road.provider === 'mapbox' ? 'https://www.mapbox.com/about/maps/' : 'https://maps.google.com'} target="_blank" rel="noreferrer">{road.provider === 'mapbox' ? 'Mapbox' : 'Google Maps'}</a></>}
            </p>
          </div>
          </div>

          <form className={`import-assignment${load.preferredDriverId ? ' import-assignment-fixed' : ''}`} onSubmit={assign}>
            {warningFields.length > 0 && <div className="import-review-warning" role="status"><strong>{t('driverBrief.warning')}</strong><p>{warningFields.map(key => briefFieldLabel(t, key)).join(', ')}</p></div>}
            {!load.preferredDriverId && <label className="import-driver-select">{t('loads.selectDriver')}
              <select value={driverId} onChange={event => setDriverId(event.target.value)} disabled={submitting}>
                <option value="">{t('loads.selectDriver')}</option>
                {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}{driver.truck ? ` · ${driver.truck}` : ''}</option>)}
              </select>
            </label>}
            {submitError && <p role="alert" className="import-blocked">{submitError}</p>}
            <div className="import-actions">
              <button type="button" className="import-button" onClick={onBack} disabled={submitting}>{t('loadImport.back')}</button>
              <button type="submit" className="import-button primary" disabled={!eligible}>{submitting ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={19} />}{t('loadImport.assign')}</button>
            </div>
          </form>
        </article>

        <aside className="import-right-column">
          <ImportRouteMap enabled={enableMap && mapState.routeEnabled}
            pickup={details.pickup.address ? stopAddress(details.pickup) : ''}
            delivery={details.delivery.address ? stopAddress(details.delivery) : ''}
            driverId={driverId} driverName={selectedDriver?.name} roadRoute={routeState}
            livePosition={target?.status === 'ready' ? { lat: target.originLatitude, lng: target.originLongitude } : null} />
            <section className="import-card">
              <h2>{t('loadImport.broker')}</h2>
              <p className="import-broker-name">{show(details.broker)}</p>
              <p className="import-contact">{show(details.brokerContact)}</p>
              <dl className="import-facts">
                <Fact label={t('common.phone')} value={details.brokerPhone ? <a href={phoneHref(details.brokerPhone)}>{details.brokerPhone}</a> : '—'} />
                <Fact label={t('common.email')} value={show(details.brokerEmail)} />
              </dl>
            </section>
          <ImportDocumentDetails details={details} selectedDriver={selectedDriver} />
        </aside>
      </div>
    </>}
  </section>;
}

function Metric({ icon: Icon, label, value }) {
  return <div><Icon size={23} /><span><strong>{value}</strong><small>{label}</small></span></div>;
}
function Fact({ label, value }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Stop({ number, title, stop, referenceLabel, t }) {
  const address = stopAddress(stop);
  return <section className={`import-stop stop-${stop.role}`}>
    <span className="import-stop-number">{number}</span>
    <div className="import-stop-title"><h2>{title}</h2><span>{stopScheduleParts(stop).map(([kind, value]) => kind === 'ready'
      ? `${t('loadImport.readyDate')}: ${value}` : kind === 'hours' ? `${t('loadImport.hours')}: ${value}` : value).join('\n')}</span></div>
    <div className="import-stop-content">
      <div><h3><MapPin size={19} />{show(address)}</h3>{stop.facility && <p>{stop.facility}</p>}<p className="import-stop-ref"><FileText size={15} />{referenceLabel} {show(stop.reference)}</p>{stop.appointmentReference && <p>Appt #: {stop.appointmentReference}</p>}{stop.orderReferences && <p>REF: {stop.orderReferences}</p>}{stop.contact && <p>{stop.contact}</p>}</div>
      <div className="import-stop-actions">
        {stop.phone ? <a className="import-button" href={phoneHref(stop.phone)}><Phone size={15} />{stop.phone}</a> : <span className="import-button muted"><Phone size={15} />{t(stop.contactPending ? 'loadImport.contactLoading' : stop.contactError ? 'loadImport.contactError' : 'loadImport.contactMissing')}</span>}
        {stop.address && <a className="import-button" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer"><MapPin size={15} />{t('loadImport.openMap')}<ArrowUpRight size={13} /></a>}
      </div>
    </div>
    {stop.note && <p className="import-stop-note">{stop.note}</p>}
  </section>;
}
