import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Route, ReceiptText } from 'lucide-react';
import { formatNumber, formatCurrency } from '../i18n/format';
import { chartPoints, expenseSegments } from '../services/analyticsDashboard';

const colors = ['#159f89', '#287fe8', '#9672da', '#ff9438'];
const compact = value => formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 });

function Trend({ title, months, field, line = false, blue = false, a }) {
  const id = useId();
  const points = chartPoints(months, field);
  const max = Math.max(1, ...months.map(item => Number(item[field]) || 0));
  const color = blue ? '#2884ed' : '#159d86';
  const known = points.some(point => point.value != null);
  return <article className="ad-panel ad-trend">
    <header><h2>{title}</h2><span className="ad-period">{a('activityMonths')}</span></header>
    {known ? <svg viewBox="0 0 320 164" role="img" aria-label={title}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".3" /><stop offset="1" stopColor={color} stopOpacity=".03" /></linearGradient></defs>
      {[0, 1, 2, 3].map(index => <g key={index}><line x1="32" x2="310" y1={132 - index * 32} y2={132 - index * 32} stroke="var(--line)" strokeOpacity=".65" /><text x="26" y={136 - index * 32} textAnchor="end" className="ad-axis">{compact(max * index / 3)}</text></g>)}
      {line && points.map((point, index) => {
        const next = points[index + 1];
        return point.value != null && next?.value != null ? <g key={point.label}><path d={`M ${point.x} 132 L ${point.x} ${point.y} L ${next.x} ${next.y} L ${next.x} 132 Z`} fill={`url(#${id})`} /><path d={`M ${point.x} ${point.y} L ${next.x} ${next.y}`} stroke={color} strokeWidth="2.5" fill="none" /></g> : null;
      })}
      {points.map((point, index) => <g key={point.label}>
        <title>{point.label}: {point.value == null ? '—' : field === 'miles' ? formatNumber(point.value) + ' mi' : formatCurrency(point.value)}</title>
        {point.value != null && (line ? <circle cx={point.x} cy={point.y} r="3.5" fill={color} /> : <rect x={point.x - 14} y={point.y} width="28" height={Math.max(0, 132 - point.y)} rx="3" fill={color} opacity={index === points.length - 1 ? 1 : .35} />)}
        <text x={point.x} y={point.y == null ? 125 : point.y - 9} textAnchor="middle" className="ad-value">{point.value == null ? '—' : compact(point.value)}</text>
        <text x={point.x} y="153" textAnchor="middle" className="ad-axis">{point.label.slice(2)}</text>
      </g>)}
    </svg> : <div className="ad-no-data"><ReceiptText size={26} /><span>{a('noData')}</span></div>}
  </article>;
}

export default function AnalyticsDashboardPanels({ data, onOpen, onTrips, panel }) {
  const { t } = useTranslation();
  const a = key => t('analytics.' + key);
  const dashboard = data.dashboard || {};
  const lanes = dashboard.lanes || [];
  const expense = expenseSegments(dashboard.expenses);
  const maxMiles = Math.max(1, ...lanes.map(lane => lane.miles || 0));
  return <div className="ad-panels" data-panel={panel}>
    <Trend title={a('milesTrend')} months={dashboard.monthly || []} field="miles" a={a} />
    <Trend title={a('rateTrend')} months={dashboard.monthly || []} field="amount" line blue a={a} />
    <Trend title={a('fuelTrend')} months={dashboard.monthly || []} field="fuel" blue a={a} />
    <article className="ad-panel"><header><h2>{a('topLanes')}</h2><span className="ad-period">mi</span></header>
      <ol className="ad-lanes">{lanes.map((lane, index) => <li key={lane.origin + lane.destination}><span className="ad-rank">{index + 1}</span><span className="ad-lane-name" title={lane.origin + ' → ' + lane.destination}>{lane.origin} → {lane.destination}</span><span className="ad-track"><i style={{ width: ((lane.miles || 0) / maxMiles * 100) + '%' }} /></span><strong>{formatNumber(lane.miles, { maximumFractionDigits: 0 })}</strong></li>)}</ol>
      {!lanes.length && <div className="ad-no-data"><Route size={26} /><span>{a('noData')}</span></div>}
    </article>
    <article className="ad-panel"><header><h2>{a('expenseSplit')}</h2><span className="ad-period">USD</span></header>
      <div className="ad-expenses"><div className="ad-donut"><svg viewBox="0 0 120 120" role="img" aria-label={a('expenseSplit')}>
        <circle cx="60" cy="60" r="45" fill="none" stroke="var(--line)" strokeWidth="17" />
        {expense.entries.map((entry, index) => <circle key={entry.key} cx="60" cy="60" r="45" fill="none" stroke={colors[index]} strokeWidth="17" pathLength="100" strokeDasharray={`${entry.percent} ${100 - entry.percent}`} strokeDashoffset={-entry.offset} transform="rotate(-90 60 60)"><title>{a('fields.' + entry.key)}: {formatCurrency(entry.value)}</title></circle>)}
      </svg><div><strong>{expense.total == null ? '—' : '$' + compact(expense.total)}</strong><small>{a('recordedCosts')}</small></div></div>
      <ul>{expense.entries.map((entry, index) => <li key={entry.key}><i style={{ background: colors[index] }} /><span>{a('fields.' + entry.key)}</span><strong>{formatCurrency(entry.value)}</strong></li>)}</ul></div>
    </article>
    <article className="ad-panel"><header><h2>{a('recentTrips')}</h2><button onClick={onTrips} type="button" aria-label={a('allTrips')}><ChevronRight size={17} /></button></header>
      <div className="ad-recent">{data.rows.slice(0, 4).map(row => <button type="button" key={row.id} onClick={() => onOpen(row)}><span className="ad-recent-icon"><Route size={17} /></span><span><strong>{row.load_number || '—'}</strong><small>{row.pickup_city || '—'} → {row.delivery_city || '—'}</small></span><b>{formatCurrency(row.contract_amount)}</b><ChevronRight size={14} /></button>)}</div>
      {!data.rows.length && <div className="ad-no-data">{a('empty')}</div>}
    </article>
  </div>;
}
