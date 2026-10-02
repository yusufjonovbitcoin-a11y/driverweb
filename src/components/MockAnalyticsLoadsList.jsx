import { ArrowUpRight, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../i18n/format';
import { mockActiveLoad, mockLoad } from '../services/mockAnalyticsLoad';
import './mock-analytics-load.css';

const loads = [mockActiveLoad, mockLoad];

export default function MockAnalyticsLoadsList({ group, onGroup, onSelect, onRealData }) {
  const { t } = useTranslation();
  const m = key => t('mockLoad.' + key);
  const rows = loads.filter(load => load.status === group);

  return <section className="ml-list" aria-label={m('listTitle')}>
    <div className="ml-list-top">
      <div><h1>{m('listTitle')} <span className="ml-demo-tag">DEMO</span></h1><p>{m('listSubtitle')}</p></div>
      <button type="button" className="ml-list-real" onClick={onRealData}>{m('realData')} <ArrowUpRight size={15} /></button>
    </div>
    <nav className="ml-list-tabs" aria-label={m('listGroups')}>
      {['active', 'completed'].map(status => <button type="button" key={status} aria-pressed={group === status} onClick={() => onGroup(status)}>{m(status)}<span>{loads.filter(load => load.status === status).length}</span></button>)}
    </nav>
    <div className="ml-list-table"><table><thead><tr>
      <th scope="col">{m('loadNumber')}</th><th scope="col">{m('lane')}</th><th scope="col">{m('date')}</th>
      <th scope="col">{m('distance')}</th><th scope="col">{m('rateTotal')}</th><th scope="col">{m('tripBalance')}</th>
      <th scope="col">{m('status')}</th><th scope="col">{m('details')}</th>
    </tr></thead><tbody>{rows.map(load => <tr key={load.number} tabIndex={0}
      aria-label={'#' + load.number + ' · ' + load.pickup.city + ' → ' + load.delivery.city}
      onClick={event => { if (!event.target.closest('button')) onSelect(load); }}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(load); } }}>
      <td><button type="button" className="ml-list-id" onClick={() => onSelect(load)}>#{load.number}</button><small>DEMO</small></td>
      <td><strong>{load.pickup.city}, {load.pickup.state} → {load.delivery.city}, {load.delivery.state}</strong><small>{load.pickup.facility} → {load.delivery.facility}</small></td>
      <td>{load.pickup.date}</td>
      <td><span className="ml-list-number"><Route size={14} />{formatNumber(load.loadedMiles)} mi</span></td>
      <td className="ml-list-money">{formatCurrency(load.rate)}</td>
      <td className="ml-list-money">{formatCurrency(load.profit)}</td>
      <td><span className={'ml-list-status ' + (load.status === 'active' ? 'is-active' : '')}>{m(load.status === 'active' ? 'activeStatus' : 'delivered')}</span></td>
      <td><button type="button" className="ml-list-open" onClick={() => onSelect(load)}>{m('details')} <ArrowUpRight size={14} /></button></td>
    </tr>)}</tbody></table></div>
    <p className="ml-list-footnote">{m('sampleOnly')}</p>
  </section>;
}
