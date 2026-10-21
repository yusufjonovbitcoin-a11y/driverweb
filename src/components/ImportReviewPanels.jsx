import { lazy, Suspense, useId, useRef, useState } from 'react';
import { ArrowRight, Building2, Check, ClipboardList, DollarSign, FileText, Info, LayoutDashboard, LoaderCircle, Mail, MapPin, Package, Phone, Route, Truck, Weight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../i18n/format';
import { briefFieldLabel } from '../services/driverBrief';
import { stopAddress, stopScheduleParts } from './importedLoadModel';
import { loadReviewRequirementRows } from './savedLoadReviewModel.js';

const DocumentReader = lazy(() => import('./DocumentViewerModal').then(module => ({ default: module.FreshDocumentViewer })));
const TABS = [
  ['overview', LayoutDashboard], ['route', MapPin], ['cargo', Package],
  ['broker', Building2], ['requirements', ClipboardList], ['documents', FileText],
];
const CARGO_FIELDS = ['cargoDescription', 'equipmentType', 'weightPrinted', 'weightLbs', 'lengthPrinted', 'widthPrinted', 'heightPrinted', 'quantityPrinted', 'palletCount', 'caseCount', 'pieceCount', 'packageCount', 'temperatureFahrenheit', 'isHazmat', 'bolNumber'];
const PAYMENT_FIELDS = ['paymentTerms', 'billingEmail', 'requiredDocuments', 'documentDeadline', 'accessorialTerms', 'carrierName', 'carrierMc', 'carrierDot', 'documentDriverName', 'documentDriverPhone'];
const show = value => value == null || value === '' ? '—' : String(value);

export default function ImportReviewPanels({ load, details, selectedDriver, stops, map, roadSummary, road, ratePerMile, showRouteFacts = true,
  overviewContent, documentsContent, requirementsContent, sourceNoteKey = 'importWorkspace.sourceNote', keepMounted = false }) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState('overview');
  const tabRefs = useRef({});
  const panelRef = useRef(null);
  const fields = new Map(details.fields.map(field => [field.key, field]));
  const fileName = load.fileName || load.driverBrief?.sourceFileName || load.documentMeta?.rateCon?.fileName || t('documents.brokerRateCon');
  const sourceUrl = load.sourceUrl || load.documents?.rateCon;
  const requirements = loadReviewRequirementRows(details);
  const weight = details.weightPrinted || (details.weight == null ? '—' : `${formatNumber(details.weight)} lb`);
  const display = value => typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : show(value);
  function selectTab(key, focus = false) {
    setTab(key);
    if (panelRef.current) panelRef.current.scrollTop = 0;
    if (focus) {
      tabRefs.current[key]?.focus({ preventScroll: true });
      tabRefs.current[key]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function keyboard(event) {
    const index = TABS.findIndex(([key]) => key === tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    selectTab(TABS[next][0], true);
  }
  const sourceNote = <p className="review-note"><Info size={17} />{t(sourceNoteKey)}</p>;
  const shortcuts = <div className="review-stack">
    <section className="review-card review-shortcut">
      <h2><Building2 size={20} />{t('importWorkspace.broker')}</h2>
      <h3>{show(details.broker)}</h3><p>{show(details.brokerContact)}</p>
      <button type="button" className="review-text-button" onClick={() => selectTab('broker', true)}><Phone size={16} />{t('importWorkspace.brokerContacts')}<ArrowRight size={16} /></button>
    </section>
    <section className="review-card review-shortcut">
      <h2><FileText size={20} />{t('importWorkspace.documents')}</h2>
      <button type="button" className="review-file-link" onClick={() => selectTab('documents', true)}><span className="review-file-icon"><FileText size={25} /></span><span>{fileName}</span><ArrowRight size={17} /></button>
      {sourceNote}
    </section>
  </div>;

  return <>
    <div className="review-tabs" role="tablist" aria-label={t('importWorkspace.sections')}>
      {TABS.map(([key, Icon]) => <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-controls={`${id}-${key}-panel`}
        aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} ref={node => { tabRefs.current[key] = node; }} onKeyDown={keyboard} onClick={() => selectTab(key)}>
        <Icon size={19} /><span>{t(`importWorkspace.${key}`)}</span>{key === 'requirements' && <small>{requirements.length}</small>}
      </button>)}
    </div>
    <div className="review-panels" ref={panelRef}>
      {TABS.map(([key]) => <div key={key} id={`${id}-${key}-panel`} role="tabpanel" aria-labelledby={`${id}-${key}`} tabIndex={0} hidden={tab !== key}>
        {(keepMounted || tab === key) && key === 'overview' && <>
          <div className="review-stat-grid">
            <Stat icon={DollarSign} label={t('loads.rate')} value={formatCurrency(details.rate)} tone="green" />
            <Stat icon={Weight} label={t('loads.weight')} value={weight} />
            <Stat icon={MapPin} label={t('importWorkspace.stops')} value={details.stops.length} />
            <Stat icon={ClipboardList} label={t('importWorkspace.requirements')} value={requirements.length} />
          </div>
          {overviewContent}
          <div className="review-columns">
            <section className="review-card">
              <div className="review-card-heading"><div><h2>{t('importWorkspace.routeSummary')}</h2><p>{t('importWorkspace.routeHint')}</p></div><button className="import-button" type="button" onClick={() => selectTab('route', true)}><Route size={16} />{t('importWorkspace.openRoute')}</button></div>
              <div className="review-route-summary">
                {details.stops.map((stop, index) => <div className={`review-mini-stop ${stop.role}`} key={index}>
                  <span className="review-pin"><MapPin size={23} /></span><div><span>{t(stop.role === 'pickup' ? 'inbox.pickup' : 'inbox.delivery')}</span><h3>{[stop.city, stop.state].filter(Boolean).join(', ') || stop.facility || show(stop.address)}</h3><p>{stopAddress(stop) || '—'}</p>
                    <Schedule stop={stop} t={t} />
                  </div>
                </div>)}
              </div>
              <div className="review-route-distance"><Truck size={18} /><span>{t(road?.loadedMiles != null ? 'loadImport.route' : 'loadImport.documentMiles')}</span><strong>{road?.loadedMiles != null ? `≈ ${formatNumber(road.loadedMiles)} mi` : details.distance != null ? `${formatNumber(details.distance)} mi` : '—'}</strong></div>
              <h3 className="review-subheading">{t('importWorkspace.cargoInfo')}</h3>
              <dl className="review-inline-facts"><Fact label={t('loads.equipment')} value={details.equipment} /><Fact label={t('importWorkspace.cargoDescription')} value={details.cargo} /><Fact label="BOL №" value={details.bolNumber} /></dl>
            </section>
            {shortcuts}
          </div>
        </>}
        {(keepMounted || tab === key) && key === 'route' && <div className="review-route-columns">
          <section className="review-card"><div className="review-card-heading"><h2><Route size={20} />{t('importWorkspace.routeStops')}</h2><span className="review-count">{details.stops.length}</span></div>{stops}</section>
          <div className="review-stack"><div className="review-map-frame">{map}</div>{roadSummary}{showRouteFacts && <section className="review-card"><dl className="review-inline-facts"><Fact label={t('loadImport.documentMiles')} value={details.distance == null ? '—' : `${formatNumber(details.distance)} mi`} /><Fact label={t(ratePerMile.source === 'route' ? 'loadImport.estimatedRpm' : 'loadImport.documentRpm')} value={ratePerMile.value == null ? '—' : `${formatCurrency(ratePerMile.value)}/mi`} /></dl></section>}</div>
        </div>}
        {(keepMounted || tab === key) && key === 'cargo' && <div className="review-columns">
          <section className="review-card"><h2><Package size={20} />{t('importWorkspace.cargoInfo')}</h2>
            <div className="review-cargo-banner"><span className="review-icon"><Package size={28} /></span><div><small>{t('importWorkspace.cargoDescription')}</small><h3>{show(details.cargo)}</h3><p>{show(details.equipment)}</p></div></div>
            <dl className="review-data-grid">{CARGO_FIELDS.map(fieldKey => {
              const fallback = { cargoDescription: details.cargo, equipmentType: details.equipment, weightPrinted: details.weightPrinted, weightLbs: details.weight, palletCount: details.pallets, caseCount: details.cases, pieceCount: details.pieces, packageCount: details.packages, temperatureFahrenheit: details.temperature, isHazmat: details.hazmat, bolNumber: details.bolNumber };
              const field = fields.get(fieldKey);
              return <div key={fieldKey}><dt>{briefFieldLabel(t, fieldKey)}</dt><dd>{display(field?.value ?? fallback[fieldKey])}<Evidence field={field} t={t} aiDirect={details.aiDirect} /></dd></div>;
            })}</dl>
          </section><div className="review-stack"><section className="review-card"><h2><Info size={20} />{t('importWorkspace.extractedData')}</h2>{sourceNote}<button className="import-button" type="button" onClick={() => selectTab('documents', true)}><FileText size={17} />{t('importWorkspace.checkOriginal')}</button></section>
            {details.instructions && <section className="review-card"><h2>{t('importWorkspace.instructions')}</h2><p className="review-prose">{details.instructions}</p><Evidence field={fields.get('specialInstructions')} t={t} aiDirect={details.aiDirect} /></section>}</div>
        </div>}
        {(keepMounted || tab === key) && key === 'broker' && <div className="review-columns">
          <section className="review-card"><h2><Building2 size={20} />{t('loadImport.broker')}</h2><div className="review-company"><span className="review-icon"><Building2 size={32} /></span><div><small>{t('importWorkspace.broker')}</small><h3>{show(details.broker)}</h3><Evidence field={fields.get('broker.name')} t={t} aiDirect={details.aiDirect} /></div></div>
            <dl className="review-broker-facts">{[['broker.contactName', details.brokerContact, null], ['broker.phone', details.brokerPhone, details.brokerPhone ? `tel:${details.brokerPhone.replace(/[^+\d]/g, '')}` : null], ['broker.email', details.brokerEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.brokerEmail || '') ? `mailto:${details.brokerEmail}` : null]].map(([fieldKey, value, href]) => <div key={fieldKey}><dt>{briefFieldLabel(t, fieldKey)}</dt><dd>{href ? <a href={href}>{fieldKey === 'broker.phone' ? <Phone size={17} /> : <Mail size={17} />}{value}</a> : show(value)}<Evidence field={fields.get(fieldKey)} t={t} aiDirect={details.aiDirect} /></dd></div>)}</dl>
          </section><div className="review-stack"><section className="review-card"><h2><FileText size={20} />{t('importWorkspace.documentSource')}</h2><p className="review-filename">{fileName}</p>{sourceNote}<button type="button" className="import-button" onClick={() => selectTab('documents', true)}>{t('importWorkspace.checkOriginal')}<ArrowRight size={16} /></button></section><section className="review-card"><h2><ClipboardList size={20} />{t('importWorkspace.requirements')}</h2><p className="review-muted">{t('importWorkspace.requirementsHint')}</p><button type="button" className="review-text-button" onClick={() => selectTab('requirements', true)}>{t('importWorkspace.openRequirements')}<span className="review-count">{requirements.length}</span><ArrowRight size={16} /></button></section></div>
        </div>}
        {(keepMounted || tab === key) && key === 'requirements' && <div className="review-columns">
          <section className="review-card"><div className="review-card-heading"><h2><ClipboardList size={20} />{t('importWorkspace.requirements')}</h2><span className="review-count">{requirements.length}</span></div>
            <p className="review-note"><Info size={17} />{t('importWorkspace.originalLanguage')}</p>
            {requirementsContent}
            {requirements.length ? <ol className="review-requirements">{requirements.map((field, index) => <li key={field.key}><span>{index + 1}</span><div><p>{display(field.value)}</p><Evidence field={field} t={t} aiDirect={details.aiDirect} /></div></li>)}</ol> : <p className="review-empty">{t('loadImport.notProvided')}</p>}
            {!details.operationalOnly && <>
              <details className="review-extra"><summary>{t('importDetails.payment')}</summary><p className="review-note">{t('importDetails.staffOnly')}</p>{details.documentDriverName && <p className="import-detail-notice warning">{t('importDetails.driverCheck', { documentDriver: details.documentDriverName, selectedDriver: selectedDriver?.name || '—' })}</p>}<dl className="review-data-grid">{PAYMENT_FIELDS.map(fieldKey => <div key={fieldKey}><dt>{briefFieldLabel(t, fieldKey)}</dt><dd>{display(fields.get(fieldKey)?.value)}<Evidence field={fields.get(fieldKey)} t={t} aiDirect={details.aiDirect} /></dd></div>)}</dl></details>
              <details className="review-extra"><summary>{t('importDetails.terms')}</summary><p className="review-note">{t(details.aiDirect ? 'importDetails.aiDirectTerms' : 'importDetails.originalTerms')}</p>{details.fields.filter(field => field.key.startsWith('contractTerms.')).map(field => <div className="review-prose" key={field.key}>{display(field.value)}<Evidence field={field} t={t} aiDirect={details.aiDirect} /></div>)}</details>
            </>}
          </section><div className="review-stack"><section className="review-card"><h2><Info size={20} />{t('importWorkspace.instructions')}</h2><p className="review-prose">{details.instructions || t('loadImport.notProvided')}</p><Evidence field={fields.get('specialInstructions')} t={t} aiDirect={details.aiDirect} /></section><section className="review-card">{sourceNote}<button type="button" className="import-button" onClick={() => selectTab('documents', true)}>{t('importWorkspace.checkOriginal')}<ArrowRight size={16} /></button></section></div>
        </div>}
        {(keepMounted || tab === key) && key === 'documents' && ((typeof documentsContent === 'function' ? documentsContent(tab === key) : documentsContent) || <div className="review-document-columns">
          <aside className="review-stack"><section className="review-card"><h2><FileText size={20} />{t('importWorkspace.documentSource')}</h2><div className="review-source-file"><span className="review-file-icon"><FileText size={28} /></span><strong>{fileName}</strong><Check size={17} /></div>{sourceNote}</section><section className="review-card"><h2>{t('importWorkspace.extractedData')}</h2><dl className="review-broker-facts"><Fact label={t('loads.loadNumber')} value={details.number} /><Fact label={t('loads.rate')} value={formatCurrency(details.rate)} /><Fact label={t('importWorkspace.stops')} value={details.stops.length} /></dl></section></aside>
          <section className="review-document-viewer" aria-label={t('importWorkspace.documentPreview')}>
            {sourceUrl || load.documentMeta?.rateCon?.current_version_id ? <Suspense fallback={<div className="review-empty" role="status"><LoaderCircle className="animate-spin" size={24} />{t('documents.loadingPdf')}</div>}><DocumentReader document={{ url: sourceUrl, versionId: load.sourceUrl?.startsWith('blob:') ? null : load.documentMeta?.rateCon?.current_version_id, fileName, title: fileName, mimeType: load.documentMeta?.rateCon?.mimeType || (/\.pdf$/i.test(fileName) ? 'application/pdf' : undefined) }} /></Suspense> : <p className="review-empty">{t('loadImport.notProvided')}</p>}
          </section>
        </div>)}
      </div>)}
    </div>
  </>;
}

function Stat({ icon: Icon, label, value, tone = 'blue' }) {
  return <div className={`review-stat ${tone}`}><span className="review-icon"><Icon size={24} /></span><div><span>{label}</span><strong>{value}</strong></div></div>;
}
function Fact({ label, value }) { return <div><dt>{label}</dt><dd>{show(value)}</dd></div>; }
function Schedule({ stop, t }) {
  if (stop.scheduleLines) return <div className="review-schedule">{stop.scheduleLines.map((line, index) => <p key={index}>{line}</p>)}</div>;
  return <div className="review-schedule">{stopScheduleParts(stop).map(([kind, value]) => <p key={kind}>{kind === 'ready' ? `${t('loadImport.readyDate')}: ` : kind === 'hours' ? `${t('loadImport.hours')}: ` : ''}{value}</p>)}</div>;
}
function Evidence({ field, t, aiDirect }) {
  if (!field || (!field.page && !field.quote)) return null;
  return <details className="import-field-evidence"><summary>{field.page ? t(aiDirect ? 'importDetails.aiPage' : 'importDetails.page', { page: field.page }) : t('importDetails.aiQuote')}</summary>{field.quote && <blockquote>{field.quote}</blockquote>}</details>;
}
