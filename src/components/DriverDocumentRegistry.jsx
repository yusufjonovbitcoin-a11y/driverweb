import { useState } from 'react';
import { CheckCircle2, ChevronRight, FileText, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatAppointment, formatNumber } from '../i18n/format';
import { DateRangePicker } from './CalendarPicker';
import { driverDocumentRegistry } from './driverDocumentRegistryModel.js';
import usePdfDocumentWarmup from './usePdfDocumentWarmup.js';
import LoadNumber from './LoadNumber.jsx';
import './driver-document-registry.css';

const types = ['rateCon', 'shipperBol', 'receiverPod', 'receipt'];

export default function DriverDocumentRegistry({ loads = [], driverId, onOpenDocs }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [range, setRange] = useState({ from: '', to: '' });
  const labels = Object.fromEntries(types.map(type => [type, t('driverDocuments.' + type)]));
  const groups = driverDocumentRegistry(loads, driverId, { query, ...range, labels });
  usePdfDocumentWarmup(groups.flatMap(group => group.documents));
  const count = groups.reduce((total, group) => total + group.documents.length, 0);

  return <div className="driver-document-registry">
    <header className="ddr-heading"><div><h2>{t('driverDetailTabs.documents')}</h2><p>{t('driverDetailTabs.loadDocuments')}</p></div><span>{t('driverDocuments.summary', { loads: groups.length, documents: count })}</span></header>
    <div className="ddr-tools"><label className="ddr-search"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('driverDocuments.search')} aria-label={t('driverDocuments.search')} /></label><DateRangePicker value={range} onChange={setRange} title={t('driverDetailTabs.plannedDelivery')} /></div>
    {groups.length ? <div className="ddr-table-scroll"><table className="ddr-table" aria-label={t('driverDetailTabs.documents')}>
      <colgroup>{[15, 27, 14, 24, 9, 11].map((width, index) => <col key={index} style={{ width: width + '%' }} />)}</colgroup>
      <thead><tr>{['loads.loadNumber', 'loads.route', 'common.status', 'driverDetailTabs.plannedDelivery', 'driverDetailTabs.documents', 'driverDocuments.actions'].map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
      <tbody>{groups.map(group => {
        const openLabel = t('driverDetailTabs.openLoad') + ' ' + group.load.loadNumber;
        const delivery = [group.delivery.scheduleDate, group.delivery.scheduleTime].filter(Boolean).join(' · ')
          || (group.delivery.appointment ? formatAppointment(group.delivery.appointment, group.delivery.timezone) : '—');
        return <tr key={group.load.id} className={'ddr-load' + (onOpenDocs ? ' is-clickable' : '')} onClick={event => {
          if (onOpenDocs && !event.target.closest('button,a')) onOpenDocs(group.load);
        }}>
          <td><button type="button" className="ddr-load-number" disabled={!onOpenDocs} onClick={() => onOpenDocs(group.load)} aria-label={openLabel}><LoadNumber load={group.load} /></button></td>
          <td className="ddr-route">{group.route}</td>
          <td><span className="ddr-completed"><CheckCircle2 size={14} aria-hidden="true" />{t('loadStatus.completed')}</span></td>
          <td><time dateTime={group.day || undefined}>{delivery}</time></td>
          <td><span className="ddr-document-count" title={t('documentWorkspace.fileCount', { count: group.documents.length })}><FileText size={16} aria-hidden="true" />{formatNumber(group.documents.length)}</span></td>
          <td><button type="button" className="ddr-open-load" disabled={!onOpenDocs} onClick={() => onOpenDocs(group.load)} aria-label={openLabel}>{t('documentManagement.view')}<ChevronRight size={16} aria-hidden="true" /></button></td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="ddr-empty" role="status">{t(query || range.from || range.to ? 'driverDetailTabs.noDocumentMatches' : 'driverDetailTabs.noCompletedLoads')}</p>}
  </div>;
}
