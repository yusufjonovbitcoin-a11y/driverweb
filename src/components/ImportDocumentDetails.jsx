import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { briefFieldLabel } from '../services/driverBrief';

const TABS = ['cargo', 'requirements', 'payment', 'terms'];
const CARGO = ['cargoDescription', 'equipmentType', 'weightPrinted', 'weightLbs', 'lengthPrinted', 'widthPrinted', 'heightPrinted', 'quantityPrinted', 'palletCount', 'caseCount', 'pieceCount', 'packageCount', 'temperatureFahrenheit', 'isHazmat'];
const PAYMENT = ['paymentTerms', 'billingEmail', 'requiredDocuments', 'documentDeadline', 'accessorialTerms', 'carrierName', 'carrierMc', 'carrierDot', 'documentDriverName', 'documentDriverPhone'];

export default function ImportDocumentDetails({ details, selectedDriver, documentsContent = null, cargoContent = null, requirementsContent = null, selectedTab, onTabChange }) {
  const { t } = useTranslation();
  const id = useId();
  const [internalTab, setInternalTab] = useState('cargo');
  const tab = selectedTab ?? internalTab;
  const setTab = onTabChange || setInternalTab;
  const baseTabs = details.operationalOnly ? ['cargo', 'requirements'] : TABS;
  const tabs = documentsContent == null ? baseTabs : ['documents', baseTabs[1], baseTabs[0], ...baseTabs.slice(2)];
  const activeTab = tabs.includes(tab) ? tab : 'cargo';
  const cargoFields = details.operationalOnly
    ? ['cargoDescription', 'equipmentType', 'weightPrinted', 'weightLbs', 'temperatureFahrenheit', 'isHazmat', 'bolNumber'] : CARGO;
  const fields = new Map(details.fields.map(field => [field.key, field]));
  const requirements = details.fields.filter(field => field.key.startsWith('requirements.'));
  const terms = details.fields.filter(field => field.key.startsWith('contractTerms.'));
  const display = value => value == null ? '—' : typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : String(value);

  function keyboard(event) {
    const index = tabs.indexOf(activeTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next == null) return;
    event.preventDefault(); setTab(tabs[next]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  }

  const requirementsBody = <>
        {details.instructions && <div className="import-detail-notice"><p>{details.instructions}</p>{fields.has('specialInstructions') && <Evidence field={fields.get('specialInstructions')} t={t} aiDirect={details.aiDirect} />}</div>}
        {requirements.length > 0 ? <Clauses fields={requirements} t={t} aiDirect={details.aiDirect} /> : details.requirements.length > 0 ? <ol className="import-clause-list">{details.requirements.map((text, i) => <li key={i}>{text}</li>)}</ol> : !details.instructions && <p className="import-muted">{t('loadImport.notProvided')}</p>}
      </>;

  return <section className="import-card import-document-details">
    <div className="import-detail-tabs" role="tablist" aria-label={t('importDetails.title')}>
      {tabs.map(key => <button key={key} type="button" id={`${id}-${key}`} role="tab" aria-selected={activeTab === key}
        aria-controls={`${id}-${key === 'documents' ? 'documents' : key === 'requirements' && requirementsContent != null ? 'requirements' : 'content'}-panel`} tabIndex={activeTab === key ? 0 : -1} onKeyDown={keyboard} onClick={() => setTab(key)}>
        {t(key === 'documents' ? 'loads.documents' : `importDetails.${key}`)}{key === 'requirements' && requirements.length > 0 && <small>{requirements.length}</small>}
      </button>)}
    </div>
    <div className="import-detail-panel" role="tabpanel" id={`${id}-content-panel`} aria-labelledby={`${id}-${activeTab}`} tabIndex={0} key={activeTab} hidden={activeTab === 'documents' || (activeTab === 'requirements' && requirementsContent != null)}>
      {details.operationalOnly && !cargoContent && <p className="import-detail-notice">{t('importDetails.operationalScope')}</p>}
      {!details.extendedDocument && !cargoContent && <p className="import-detail-notice">{t('importDetails.legacy')}</p>}
      {activeTab === 'cargo' && cargoContent}
      {((activeTab === 'cargo' && !cargoContent) || activeTab === 'payment') && <>
        {activeTab === 'payment' && <p className="import-detail-notice">{t('importDetails.staffOnly')}</p>}
        {activeTab === 'payment' && details.documentDriverName && <p className="import-detail-notice warning">{t('importDetails.driverCheck', { documentDriver: details.documentDriverName, selectedDriver: selectedDriver?.name || '—' })}</p>}
        <dl className="import-detail-facts">{(activeTab === 'cargo' ? cargoFields : PAYMENT).map(key => <div key={key}>
          <dt>{briefFieldLabel(t, key)}</dt><dd>{display(fields.get(key)?.value)}{fields.has(key) && <Evidence field={fields.get(key)} t={t} aiDirect={details.aiDirect} />}</dd>
        </div>)}</dl>
      </>}
      {activeTab === 'requirements' && requirementsContent == null && requirementsBody}
      {activeTab === 'terms' && <><p className="import-detail-notice">{t(details.aiDirect ? 'importDetails.aiDirectTerms' : 'importDetails.originalTerms')}</p>{terms.length ? <Clauses fields={terms} t={t} aiDirect={details.aiDirect} /> : <p className="import-muted">{t('loadImport.notProvided')}</p>}</>}
    </div>
    {requirementsContent != null && <div className="import-detail-panel import-requirements-panel" role="tabpanel"
      id={`${id}-requirements-panel`} aria-labelledby={`${id}-requirements`} tabIndex={0} hidden={activeTab !== 'requirements'}>
      {requirementsBody}
      {requirementsContent}
    </div>}
    {documentsContent != null && <div className="import-detail-panel import-documents-panel" role="tabpanel"
      id={`${id}-documents-panel`} aria-labelledby={`${id}-documents`} tabIndex={0} hidden={activeTab !== 'documents'}>
      {documentsContent}
    </div>}
  </section>;
}

function Clauses({ fields, t, aiDirect }) {
  return <ol className="import-clause-list">{fields.map(field => <li key={field.key}><p>{String(field.value)}</p><Evidence field={field} t={t} aiDirect={aiDirect} /></li>)}</ol>;
}
function Evidence({ field, t, aiDirect }) {
  if (!field.page && !field.quote) return null;
  return <details className="import-field-evidence"><summary>{field.page ? t(aiDirect ? 'importDetails.aiPage' : 'importDetails.page', { page: field.page }) : t('importDetails.aiQuote')}</summary>{field.quote && <blockquote>{field.quote}</blockquote>}</details>;
}
