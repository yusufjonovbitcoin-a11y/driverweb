import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber, formatTime } from '../../i18n/format';
import { useRef, useState } from 'react';
import { Coins, Package, RefreshCw, Search, Settings, TrendingUp, Wallet } from 'lucide-react';
import { DateRangePicker } from '../CalendarPicker';
import { financialCsv } from './financialModel.js';
import { useFinancialView } from './useFinancialView.js';
import FinancialLoadDialog from './FinancialLoadDialog';
import { LoadTable, Notice, Panel, Trend } from './FinancialWidgets';
import './driver-financial-report.css';

const money = value => value == null ? '—' : formatCurrency(value / 100);
const sum = values => values.some(value => value == null) ? null : values.reduce((total, value) => total + value, 0);

export default function DriverFinancialReport({ source, scopeDriver, drivers = [], loading, refreshing, error, onRefresh, onOpenLoad, onOpenAccountingSettings, onSaveAccounting, canEditAccounting = false }) {
  const { t, i18n } = useTranslation();

  const main = useRef(null);
  const [search, setSearch] = useState(''), [range, setRange] = useState({ from: '', to: '' });
  const [group, setGroup] = useState('completed'), [detailRow, setDetailRow] = useState(null);
  const { view, allView } = useFinancialView(source, { ...range, group, search, scopeDriverId: scopeDriver.id }, drivers);
  const total = view.totals, fees = sum([total.company, total.dispatch, total.other]);
  const detail = source && detailRow && (allView.rows.find(row => row.id === detailRow.id) || detailRow);
  const rows = [...view.rows].sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const filtered = Boolean(search || range.from || range.to);
  const metrics = [
    [t("financialCenter.loadRevenue"), money(total.gross), t("financialCenter.grossForTheSelectedPeriod"), TrendingUp],
    [t("financialCenter.commissionsAndDeductions"), money(fees), t("financialCenter.companyDispatcherAndOtherDeductions"), Coins],
    [t("financialCenter.driverNetPay"), money(total.net), t("financialCenter.fromAccountingAndSavedSettings"), Wallet],
    [t("financialCenter.trips"), total.count, total.miles == null ? t("financialCenter.someTripsHaveNoMileageRecorded") : t("financialCenter.countMiLoadedMileage", { value0: formatNumber(total.miles) }), Package],
  ];
  function refresh() { if (onRefresh) void onRefresh().catch(() => {}); }
  function reset() { setSearch(''); setRange({ from: '', to: '' }); setDetailRow(null); }
  function openDay(day) { setRange({ from: day, to: day }); setDetailRow(null); }
  function exportLoad(row) {
    if (!source || error) return;
    const url = URL.createObjectURL(new Blob([financialCsv([row])], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `T-Fleets-${row.number}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="financial-center driver-financial-report" lang={i18n.resolvedLanguage || i18n.language} aria-label={t("financialCenter.driverAnalyticsCount", { value0: scopeDriver.name })} aria-busy={loading || refreshing}>
    <div className="fc-main df-main" ref={main}>
      <header className="df-heading"><div><h1>{t("financialCenter.earningsAndTrips")}</h1><p>{scopeDriver.name} · {scopeDriver.truck || t("financialCenter.noTruckSpecified")}</p></div><div className="df-update">{source?.fetchedAt && <span>{t("financialCenter.updated")}{" "}{formatTime(new Date(source.fetchedAt), { hour: '2-digit', minute: '2-digit' })}</span>}<button type="button" onClick={refresh} disabled={!onRefresh || refreshing} aria-label={t("financialCenter.refreshAnalytics")}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button></div></header>
      <div className="df-tools"><label className="df-search"><Search size={16} /><input type="search" value={search} onChange={event => { setSearch(event.target.value); setDetailRow(null); }} placeholder={t("financialCenter.loadNumberOrCity")} aria-label={t("financialCenter.searchThisDriverSLoadsOrCities")} /></label><label className="df-status"><span className="sr-only">{t("financialCenter.trips")}</span><select aria-label={t("financialCenter.trips")} value={group} onChange={event => { setGroup(event.target.value); setDetailRow(null); }}><option value="completed">{t("financialCenter.completed")}{view.counts.completed})</option><option value="active">{t("financialCenter.active")}{view.counts.active})</option><option value="planned">{t("financialCenter.planned")}{view.counts.planned})</option><option value="all">{t("financialCenter.allExceptCancelled")}{view.counts.all})</option></select></label><DateRangePicker value={range} onChange={value => { setRange(value); setDetailRow(null); }} /></div>
      {filtered && <div className="df-filtered"><span>{t("financialCenter.tripsFound")}{" "}{total.count}</span><button type="button" onClick={reset}>{t("financialCenter.clearFilters")}</button></div>}
      {loading && !source && <p className="fc-empty" role="status">{t("financialCenter.loadingDriverData")}</p>}
      {error && <div className="fc-live-error" role="alert"><span>{source ? t("financialCenter.couldNotRefreshDataPreviousAmountsAre") : t("financialCenter.couldNotLoadDriverAnalytics")}</span><button onClick={refresh} disabled={refreshing}>{t("financialCenter.retry")}</button></div>}
      {source && <>
        <p className="fc-basis">{t("financialCenter.amountSources", { approved: total.approvedCount, recorded: total.recordedCount, estimated: total.estimatedCount, unknown: total.unknownNet })}</p>{source.settlementsAvailable === false && <p className="fc-basis">{t('financialCenter.settlementsAccessLimited')}</p>}<div className="df-summary">{metrics.map(([label, value, hint, Icon], index) => <article className={`df-stat${index === 2 ? ' df-stat-net' : ''}`} key={label}><div><span>{label}</span><Icon size={18} /></div><strong>{value}</strong><small>{hint}</small></article>)}</div>
        {(total.unknownGross > 0 || total.unknownNet > 0) && <p className="df-missing" role="status">{t("financialCenter.someAmountsAreMissingUnknownValuesAre")}</p>}
        <div className="df-overview"><Trend daily={view.daily} total={total} onDate={openDay} /><Panel title={t("financialCenter.statementPeriod")} className="df-calculation" actions={onOpenAccountingSettings && <button type="button" onClick={onOpenAccountingSettings} aria-label={t("financialCenter.calculationSettings")}><Settings size={16} /></button>}><dl>{[['Gross', total.gross], [t("financialCenter.companyCommission"), total.company], [t("financialCenter.dispatcherCommission"), total.dispatch], [t("financialCenter.otherDeductions"), total.other], ...(total.adjustment ? [[t("financialCenter.unallocated"), total.adjustment]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}<div className="df-total"><dt>{t("financialCenter.driverNetPay")}</dt><dd>{money(total.net)}</dd></div></dl></Panel></div>
        <Panel title={t("financialCenter.driverLoadsCount", { value0: total.count })} className="df-loads"><LoadTable rows={rows} onSelect={row => setDetailRow(row)} /><Notice /></Panel>
      </>}
    </div>
    {detail && <FinancialLoadDialog key={detail.id} row={detail} onClose={() => setDetailRow(null)} onExport={!error ? exportLoad : undefined} onOpenLoad={onOpenLoad ? id => { setDetailRow(null); onOpenLoad(id); } : undefined} onSaveAccounting={onSaveAccounting} canEdit={canEditAccounting && Boolean(onSaveAccounting)} />}
  </section>;
}
