import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { briefFieldLabel } from '../services/driverBrief';

const TABS = ['cargo', 'requirements', 'payment', 'terms'];
const CARGO = ['cargoDescription', 'equipmentType', 'weightPrinted', 'weightLbs', 'lengthPrinted', 'widthPrinted', 'heightPrinted', 'quantityPrinted', 'palletCount', 'caseCount', 'pieceCount', 'packageCount', 'temperatureFahrenheit', 'isHazmat'];
const PAYMENT = ['paymentTerms', 'billingEmail', 'requiredDocuments', 'documentDeadline', 'accessorialTerms', 'carrierName', 'carrierMc', 'carrierDot', 'documentDriverName', 'documentDriverPhone'];

export default function ImportDocumentDetails({ details, selectedDriver }) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState('cargo');
  const fields = new Map(details.fields.map(field => [field.key, field]));
  const requirements = details.fields.filter(field => field.key.startsWith('requirements.'));
  const terms = details.fields.filter(field => field.key.startsWith('contractTerms.'));
  const display = value => value == null ? '—' : typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : String(value);

  function keyboard(event) {
    const index = TABS.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
    if (next == null) return;
    event.preventDefault(); setTab(TABS[next]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  }

  return <section className="import-card import-document-details">
    <div className="import-detail-tabs" role="tablist" aria-label={t('importDetails.title')}>
      {TABS.map(key => <button key={key} type="button" id={`${id}-${key}`} role="tab" aria-selected={tab === key}
        aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} onKeyDown={keyboard} onClick={() => setTab(key)}>
        {t(`importDetails.${key}`)}{key === 'requirements' && requirements.length > 0 && <small>{requirements.length}</small>}
      </button>)}
    </div>
    <div className="import-detail-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0} key={tab}>
      {!details.extendedDocument && <p className="import-detail-notice">{t('importDetails.legacy')}</p>}
      {(tab === 'cargo' || tab === 'payment') && <>
        {tab === 'payment' && <p className="import-detail-notice">{t('importDetails.staffOnly')}</p>}
        {tab === 'payment' && details.documentDriverName && <p className="import-detail-notice warning">{t('importDetails.driverCheck', { documentDriver: details.documentDriverName, selectedDriver: selectedDriver?.name || '—' })}</p>}
        <dl className="import-detail-facts">{(tab === 'cargo' ? CARGO : PAYMENT).map(key => <div key={key}>
          <dt>{briefFieldLabel(t, key)}</dt><dd>{display(fields.get(key)?.value)}{fields.has(key) && <Evidence field={fields.get(key)} t={t} aiDirect={details.aiDirect} />}</dd>
        </div>)}</dl>
      </>}
      {tab === 'requirements' && <>
        {details.instructions && <div className="import-detail-notice"><p>{details.instructions}</p>{fields.has('specialInstructions') && <Evidence field={fields.get('specialInstructions')} t={t} aiDirect={details.aiDirect} />}</div>}
        {requirements.length > 0 ? <Clauses fields={requirements} t={t} aiDirect={details.aiDirect} /> : details.requirements.length > 0 ? <ol className="import-clause-list">{details.requirements.map((text, i) => <li key={i}>{text}</li>)}</ol> : !details.instructions && <p className="import-muted">{t('loadImport.notProvided')}</p>}
      </>}
      {tab === 'terms' && <><p className="import-detail-notice">{t(details.aiDirect ? 'importDetails.aiDirectTerms' : 'importDetails.originalTerms')}</p>{terms.length ? <Clauses fields={terms} t={t} aiDirect={details.aiDirect} /> : <p className="import-muted">{t('loadImport.notProvided')}</p>}</>}
    </div>
  </section>;
}

function Clauses({ fields, t, aiDirect }) {
  return <ol className="import-clause-list">{fields.map(field => <li key={field.key}><p>{String(field.value)}</p><Evidence field={field} t={t} aiDirect={aiDirect} /></li>)}</ol>;
}
function Evidence({ field, t, aiDirect }) {
  if (!field.page && !field.quote) return null;
  return <details className="import-field-evidence"><summary>{field.page ? t(aiDirect ? 'importDetails.aiPage' : 'importDetails.page', { page: field.page }) : t('importDetails.aiQuote')}</summary>{field.quote && <blockquote>{field.quote}</blockquote>}</details>;
}
