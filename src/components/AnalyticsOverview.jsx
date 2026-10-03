import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspaceInvalidation, useWorkspaceQuery, useWorkspaceView } from '../hooks/WorkspaceCache';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronLeft, ChevronRight, X, CalendarDays, ChevronDown } from 'lucide-react';
import { formatCurrency, formatDate } from '../i18n/format';
import { loadStatusLabel } from '../i18n/labels';
import { accountingFields, accountingPayload, accountingPreview, accountingErrorKey } from '../services/tripAccounting';
import { fetchTripAnalytics, saveTripAccounting } from '../services/tripAnalyticsService';
import './trip-analytics.css';
import MockAnalyticsLoad from './MockAnalyticsLoad';
import MockAnalyticsLoadsList from './MockAnalyticsLoadsList';

function AccountingEditor({ row, onClose, onSaved }) {
  const { t } = useTranslation();
  const a = (key, options) => t('analytics.' + key, options);
  const initialValues = Object.fromEntries(accountingFields.map(key => [key, row[key] == null ? '' : String(row[key])]));
  const [values, setValues] = useState(initialValues);
  const [notes, setNotes] = useState(row.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues) || notes !== (row.notes || '');
  const readOnly = row.trip_group === 'cancelled' || row.isDemo;
  let preview = {};
  try { preview = accountingPreview(row.contract_amount, values); } catch { /* Invalid input is reported on save. */ }

  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function submit(event) {
    event.preventDefault();
    if (saving || readOnly) return;
    setError(null);
    setSaving(true);
    try {
      await saveTripAccounting(row, accountingPayload(values), notes);
      onSaved();
    } catch (failure) { setError(failure); }
    finally { setSaving(false); }
  }
  function close() {
    if (!dirty || window.confirm(a('discard'))) onClose();
  }

  return <section className="trip-editor" aria-label={a('accounting')}>
    <header><div><h2>{a('accounting')} · {row.load_number || '—'}</h2><p>{a(row.isDemo ? 'demoHint' : 'manualHint')}</p></div>
      <button type="button" onClick={close} disabled={saving} aria-label={a('close')}><X size={18} /></button></header>
    <div className="trip-basis"><span>{a('contract')}: <strong>{formatCurrency(row.contract_amount)}</strong></span>
      <span>{a(row.isDemo ? 'demoTitle' : row.price_source === 'accepted_snapshot' ? 'snapshot' : 'currentRate')}</span>
      {row.requires_reconfirmation && <strong role="status">{a('reconfirm')}</strong>}
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={saving || readOnly} className="trip-input-grid">
        {accountingFields.map(key => <label key={key}>{a('fields.' + key)} · USD
          <input inputMode="decimal" autoComplete="off" maxLength={13} placeholder="—" value={values[key]}
            onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))} />
        </label>)}
        <label className="trip-notes">{a('notes')}<textarea rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      </fieldset>
      <p className="trip-help">{a('unknownHint')}</p>
      <div className="trip-preview">{['revenue', 'costs', 'balance', 'outstanding'].map(key => <div key={key}><span>{a(key)}</span><strong className={preview[key] < 0 ? 'trip-negative' : ''}>{formatCurrency(preview[key])}</strong></div>)}</div>
      <p className="trip-help">{a('formula')}</p>
      {row.has_receipt && <p className="trip-help">{a('receiptHint')}</p>}
      {row.accounting_updated_at && <p className="trip-help">{a('updated')}: {formatDate(row.accounting_updated_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      {error && <p className="trip-error" role="alert">{t(accountingErrorKey(error))}</p>}
      <footer><button type="button" disabled={saving} onClick={close}>{a('close')}</button>
        {!readOnly && <button className="trip-primary" type="submit" disabled={saving || !dirty}>{a(saving ? 'saving' : 'save')}</button>}</footer>
    </form>
  </section>;
}

export default function AnalyticsOverview() {
  const { t } = useTranslation();
  const a = (key, options) => t('analytics.' + key, options);
  const [filters, setFilters] = useWorkspaceView('analytics.filters', { group: 'active', search: '', from: '', to: '', page: 1, pageSize: 4 });
  const [search, setSearch] = useState(filters.search);
  const invalidate = useWorkspaceInvalidation();
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useWorkspaceView('analytics.mode', 'mock');
  const [selectedMockLoad, setSelectedMockLoad] = useState(null);
  const [mockLoadGroup, setMockLoadGroup] = useWorkspaceView('analytics.mockGroup', 'active');
  const tableArea = useRef(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const { data, error, isLoading, isValidating, mutate: refresh } = useWorkspaceQuery(
    mode === 'real' && layoutReady ? ['trip-analytics', filters] : null,
    ([, query]) => fetchTripAnalytics(query),
    { staleTime: 30_000, refreshInterval: 60_000 },
  );
  const loading = !layoutReady || isLoading;

  useLayoutEffect(() => {
    if (mode !== 'real' || editing || !tableArea.current) return;
    const measure = (height) => {
      const pageSize = Math.max(1, Math.min(8, Math.floor((height - 100) / 90)));
      setFilters(previous => previous.pageSize === pageSize ? previous : { ...previous, page: 1, pageSize });
      setLayoutReady(true);
    };
    // Size the persistent table shell before starting the first query.
    measure(tableArea.current.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.height));
    observer.observe(tableArea.current);
    return () => observer.disconnect();
  }, [mode, editing, setFilters]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters(previous => previous.search === search ? previous : ({ ...previous, search, page: 1 })), 300);
    return () => clearTimeout(timer);
  }, [search, setFilters]);

  function filter(key, value) { setSaved(false); setFilters(previous => ({ ...previous, [key]: value, page: 1 })); }
  const pages = Math.max(1, Math.ceil((data?.total || 0) / filters.pageSize));

  if (mode === 'mock' && !editing) {
    return selectedMockLoad
      ? <MockAnalyticsLoad load={selectedMockLoad} onBack={() => setSelectedMockLoad(null)} />
      : <MockAnalyticsLoadsList group={mockLoadGroup} onGroup={setMockLoadGroup} onSelect={setSelectedMockLoad}
          onRealData={() => { setLayoutReady(false); setFilters(previous => ({ ...previous, group: mockLoadGroup, page: 1 })); setMode('real'); }} />;
  }

  return <section className="trip-analytics analytics-dashboard" aria-busy={loading}>
    <header className="trip-heading"><div><h1>{a('trips')}</h1><p>{a('dashboardSubtitle')}</p></div>
      <div className="ad-header-actions">
        <button type="button" disabled={Boolean(editing)} onClick={() => { setLayoutReady(false); setSelectedMockLoad(null); setMode('mock'); }}>{t('mockLoad.sampleData')}</button>
        <details className="ad-date-picker"><summary><CalendarDays size={17} /><span>{filters.from || filters.to ? (filters.from || '…') + ' — ' + (filters.to || '…') : a('allDates')}</span><ChevronDown size={14} /></summary>
          <div><label>{a('from')}<input type="date" disabled={Boolean(editing)} value={filters.from} onChange={event => filter('from', event.target.value)} /></label><label>{a('to')}<input type="date" disabled={Boolean(editing)} value={filters.to} min={filters.from} onChange={event => filter('to', event.target.value)} /></label><p className="trip-help">{a('dateHint')}</p></div>
        </details>
        <button type="button" aria-label={a('refresh')} title={a('refresh')} disabled={isValidating || Boolean(editing)} onClick={() => { void refresh().catch(() => {}); }}><RefreshCw size={16} className={isValidating ? 'animate-spin' : ''} /></button>
      </div></header>
    {editing ? <AccountingEditor key={editing.id + ':' + editing.accounting_version} row={editing} onClose={() => setEditing(null)} onSaved={() => {
      setEditing(null); setSaved(true);
      void invalidate(key => Array.isArray(key) && key[0] === 'trip-analytics').catch(() => {});
    }} /> : <>
      <div className="ad-toolbar"><nav className="ml-list-tabs" aria-label={t('mockLoad.listGroups')}>
        {['active', 'completed'].map(group => <button type="button" key={group} aria-pressed={filters.group === group} onClick={() => filter('group', group)}>{t('mockLoad.' + group)}<span>{data?.counts?.[group] ?? '—'}</span></button>)}
      </nav><input className="ad-search" type="search" aria-label={a('search')} placeholder={a('searchHint')} value={search} onChange={event => setSearch(event.target.value)} /></div>
      {saved && <p className="trip-success" role="status">{a('saved')}</p>}
      {error && <p className="trip-error" role="alert">{t(accountingErrorKey(error))}</p>}
      <div className="ad-trips-view" ref={tableArea}>
        <div className="trip-table-wrap"><table><thead><tr>{['trip', 'driverBroker', 'status', 'contract', 'recordedCosts', 'balance', 'accounting'].map(key => <th key={key} scope="col">{a(key)}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={7}><div className="ad-loading py-8" role="status"><RefreshCw size={23} className="animate-spin" />{a('loading')}</div></td></tr> : (data?.rows || []).map(row => <tr key={row.id}>
            <td><strong>{row.load_number || '—'}</strong><small>{row.pickup_city || '—'} → {row.delivery_city || '—'}</small><small>{row.trip_date ? formatDate(row.trip_date, { timeZone: 'UTC' }) : '—'}</small></td>
            <td>{row.driver_name || '—'}<small>{row.broker_name || '—'}</small></td>
            <td><span className={'trip-status trip-status-' + row.trip_group}>{loadStatusLabel(t, row.status)}</span></td>
            <td>{formatCurrency(row.contract_amount)}</td>
            <td>{formatCurrency(row.recorded_costs)}{row.costs == null && <small>{a('incomplete')}</small>}</td>
            <td className={row.balance < 0 ? 'trip-negative' : ''}>{formatCurrency(row.balance)}</td>
            <td><button type="button" onClick={() => { setEditing(row); setSaved(false); }}>{a('open')}</button></td>
          </tr>)}</tbody></table>
          {!loading && !data?.rows?.length && !error && <p className="trip-empty">{a('empty')}</p>}
        </div>
        <footer className="trip-pagination"><span>{loading ? a('loading') : a('pagination', { page: filters.page, pages, total: data?.total || 0 })}</span><div>
          <button type="button" aria-label={a('previous')} disabled={loading || filters.page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: previous.page - 1 }))}><ChevronLeft size={18} /></button>
          <button type="button" aria-label={a('next')} disabled={loading || filters.page >= pages} onClick={() => setFilters(previous => ({ ...previous, page: previous.page + 1 }))}><ChevronRight size={18} /></button>
        </div></footer>
      </div>
    </>}
  </section>;
}
