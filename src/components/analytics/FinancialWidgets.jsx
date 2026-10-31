import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDate, formatNumber } from '../../i18n/format';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Building2, ChartNoAxesCombined, Coins, FileText, Info, Package, UserRound, Users, Wallet } from 'lucide-react';
import './financial-center.css';
import './financial-allocation.css';

const money = value => value == null ? '—' : formatCurrency(value / 100);
const percent = (value, total) => value == null || total == null ? '—' : formatNumber(total ? value / total * 100 : 0, {minimumFractionDigits:1, maximumFractionDigits:1}) + '%';
const dateLabel = (value, withYear = false) => formatDate(value + 'T12:00:00Z', { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });

const amountKeys = ['gross', 'company', 'dispatch', 'other', 'net'];

function Notice() {
  const { t } = useTranslation();
 return <p className="fc-notice"><Info size={14} />{t("financialCenter.calculatedFromCompanyDataNotAPayment")}</p>; }
function Panel({ title, children, actions, className = '', panelRef }) {
  return <section ref={panelRef} className={`fc-panel ${className}`}><header className="fc-panel-heading"><h2>{title}</h2>{actions}</header>{children}</section>;
}
function Summary({ totals: total, onView, singleDriver = false }) {
  const { t } = useTranslation();

  const items = [
    [t("financialCenter.grossLoadRevenue"), total.gross, t("financialCenter.countTrips", { value0: total.count }), ChartNoAxesCombined, 'blue'],
    [t("financialCenter.companyCommissionCalculated"), total.company, t("financialCenter.countOfGross", { value0: percent(total.company, total.gross) }), Coins, 'mint'],
    [t("financialCenter.dispatcherCommissionCalculated"), total.dispatch, t("financialCenter.countOfGross", { value0: percent(total.dispatch, total.gross) }), Users, 'blue'],
    [singleDriver ? t("financialCenter.driverNetPay") : t("financialCenter.driversNetPay"), total.net, total.unknownNet ? t("financialCenter.withoutCalculationCount", { value0: total.unknownNet }) : t("financialCenter.countOfGross", { value0: percent(total.net, total.gross) }), Wallet, 'mint'],
  ];
  return <div className="fc-summary">{items.map(([title, value, note, Icon, color], index) => <button className="fc-panel fc-stat" key={title} onClick={() => onView(['loads', 'company', 'commissions', 'drivers'][index])} aria-label={t("financialCenter.countCountOpenDetails", { value0: title, value1: money(value) })}><div><p>{title} <Info size={12} /></p><strong>{money(value)}</strong><small>{note}</small></div><Icon className={`fc-${color}`} size={31} strokeWidth={1.7} /></button>)}</div>;
}
// Connect to the rendered cards, including after wrapping, font loading and resizing.
function useAllocationLayout(count, chartReady) {
  const ref = useRef(null);
  const [layout, setLayout] = useState(null);
  useLayoutEffect(() => {
    if (!chartReady) return;
    const root = ref.current;
    const source = root.querySelector('.fc-flow-source');
    const diagram = root.querySelector('.fc-flow-diagram');
    const outputs = [...root.querySelectorAll('.fc-flow-output')];
    function measure() {
      const bounds = diagram.getBoundingClientRect();
      if (!bounds.height || !bounds.width) return;
      const sourceBounds = source.getBoundingClientRect();
      const round = value => Math.round(value * 10) / 10;
      const next = {
        height: round(bounds.height),
        source: round(sourceBounds.top + sourceBounds.height / 2 - bounds.top),
        sourceHeight: round(sourceBounds.height),
        targets: outputs.map(output => {
          const box = output.getBoundingClientRect();
          return { center: round(box.top + box.height / 2 - bounds.top), height: round(box.height) };
        }),
      };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    const observer = new ResizeObserver(measure);
    [source, diagram, ...outputs].forEach(element => observer.observe(element));
    measure();
    return () => observer.disconnect();
  }, [count, chartReady]);
  return [ref, layout];
}

function Allocation({ total, onView, singleDriver = false }) {
  const { t } = useTranslation();

  const id = useId().replaceAll(':', '');
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const activeKey = focused || hovered;
  const outputs = [
    ['net', singleDriver ? t("financialCenter.driverNetPay") : t("financialCenter.driversNetPay"), Wallet, 'var(--fc-flow-net)', 'drivers'],
    ['company', t("financialCenter.companyCommission"), Coins, 'var(--fc-flow-company)', 'company'],
    ['dispatch', t("financialCenter.dispatcherCommissions"), Users, 'var(--fc-flow-dispatch)', 'commissions'],
    ['other', t("financialCenter.otherDeductions"), FileText, 'var(--fc-flow-other)', 'commissions'],
    ...(total.adjustment ? [['adjustment', t("financialCenter.unallocated"), Info, 'var(--fc-muted)', 'company']] : []),
  ];
  const chartReady = total.gross > 0 && outputs.every(([key]) => total[key] != null && total[key] >= 0);
  const [flowRef, layout] = useAllocationLayout(outputs.length, chartReady);
  // Keep proportions exact while fitting the widest branch inside its destination.
  const band = layout && chartReady ? Math.max(0, Math.min(96, layout.sourceHeight - 32,
    ...outputs.map(([key], index) => total[key] > 0 ? (layout.targets[index]?.height ?? 64) * .8 * total.gross / total[key] : Infinity))) : 0;
  let start = (layout?.source ?? 0) - band / 2;
  const paths = outputs.map(([key, , , color], i) => {
    const height = chartReady ? total[key] / total.gross * band : 0;
    const end = (layout?.targets[i]?.center ?? 0) - height / 2;
    const path = `M0 ${start} C100 ${start} 140 ${end} 240 ${end} L240 ${end + height} C140 ${end + height} 100 ${start + height} 0 ${start + height} Z`;
    const hitPath = `M0 ${start + height / 2} C100 ${start + height / 2} 140 ${end + height / 2} 240 ${end + height / 2}`;
    start += height;
    return { path, hitPath, color, key, height };
  });
  const selected = activeKey === 'gross'
    ? ['gross', t("financialCenter.grossRevenue"), Package, 'var(--fc-blue)', 'loads']
    : outputs.find(([key]) => key === activeKey);
  const viewLabel = { loads: t("financialCenter.loads"), drivers: singleDriver ? t("financialCenter.driver") : t("financialCenter.drivers"), company: t("financialCenter.company"), commissions: t("financialCenter.commissions") };
  const describe = (key, label, view) => t("financialCenter.countCountCountOpenCount", { value0: label, value1: money(total[key]), value2: percent(total[key], total.gross), value3: viewLabel[view] });
  const tooltipId = `${id}-allocation-tooltip`;
  function dismiss(event) {
    if (event.key === 'Escape') { setHovered(null); setFocused(null); }
  }
  return <Panel title={t("financialCenter.tripRevenueAllocation")} actions={<span className="fc-flow-hint"><Info size={12} />{t("financialCenter.hoverOrClick")}</span>} className="fc-allocation">
    <div ref={flowRef} className="fc-flow" onPointerLeave={() => setHovered(null)} onKeyDown={dismiss}>
      <button className={`fc-flow-source ${activeKey === 'gross' ? 'is-active' : ''}`} disabled={!total.count} onPointerEnter={() => setHovered('gross')} onFocus={() => setFocused('gross')} onBlur={() => setFocused(null)} onClick={() => onView('loads')} aria-label={describe('gross', t("financialCenter.grossRevenue"), 'loads')} aria-describedby={activeKey === 'gross' ? tooltipId : undefined}>
        <span className="fc-source-label"><ChartNoAxesCombined size={18} aria-hidden="true" />{t("financialCenter.grossRevenue")}</span>
        <strong>{money(total.gross)}</strong>
        <span className="fc-source-meta"><small>{total.gross == null ? '—' : total.gross ? '100%' : '0%'} {t("financialCenter.ofRevenue")}</small><ArrowRight size={15} aria-hidden="true" /></span>
      </button>
      {chartReady ? <div className="fc-flow-diagram"><svg className="fc-ribbons" viewBox={`0 0 240 ${layout?.height || 1}`} preserveAspectRatio="none" role="group" aria-label={t("financialCenter.grossAllocatedToDriversCommissionsAndDeductions")} data-active={outputs.some(([key]) => key === activeKey) ? activeKey : undefined}>
        <defs>{paths.map(({ color, key }) => <linearGradient id={`${id}-${key}`} key={key}><stop stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity=".85" /></linearGradient>)}</defs>
        {layout && paths.map(({ path, hitPath, key, color, height }, index) => {
          const [, label, , , view] = outputs[index];
          const enabled = total[key] > 0;
          return <g key={key} role="button" tabIndex={enabled ? 0 : -1} aria-disabled={!enabled} aria-label={describe(key, label, view)} aria-describedby={activeKey === key ? tooltipId : undefined}
            className={`fc-ribbon-control ${activeKey === key ? 'is-active' : ''}`} data-flow-key={key}
            onPointerEnter={() => { if (enabled) setHovered(key); }} onFocus={() => { if (enabled) setFocused(key); }} onBlur={() => setFocused(null)}
            onClick={() => { if (enabled) onView(view); }} onKeyDown={event => {
              if (enabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onView(view); }
            }}>
            <path className="fc-ribbon-fill" d={path} fill={`url(#${id}-${key})`} />
            {height > 0 && height < 1.5 && <path d={hitPath} fill="none" stroke={color} strokeWidth="1" strokeOpacity=".65" vectorEffect="non-scaling-stroke" />}
            <path className="fc-ribbon-hit" d={hitPath} fill="none" vectorEffect="non-scaling-stroke" />
          </g>;
        })}
      </svg></div> : <div className="fc-flow-missing"><Info size={22} /><span>{t("financialCenter.allStatementAmountsAreRequiredForA")}</span></div>}
      <div className="fc-flow-outputs">{outputs.map(([key, label, Icon, color, view]) => <button key={key} data-allocation-key={key} style={{ '--flow-color': color }} disabled={!total.count} onClick={() => onView(view)} onPointerEnter={() => setHovered(key)} onFocus={() => setFocused(key)} onBlur={() => setFocused(null)} aria-label={describe(key, label, view)} aria-describedby={activeKey === key ? tooltipId : undefined} className={`fc-flow-output ${activeKey === key ? 'is-active' : ''}`}>
        <span className="fc-flow-icon" aria-hidden="true"><Icon size={18} /></span>
        <span className="fc-flow-label">{label}</span>
        <span className="fc-flow-value"><strong>{money(total[key])}</strong><small title={`${percent(total[key], total.gross)} ${t("financialCenter.ofRevenue")}`}>{percent(total[key], total.gross)}</small></span>
      </button>)}</div>
      {selected && <div id={tooltipId} role="tooltip" className="fc-flow-tooltip" onPointerEnter={() => setHovered(selected[0])}><span style={{ color: selected[3] }} aria-hidden="true">●</span><div><b>{selected[1]}</b><strong>{money(total[selected[0]])} <small>· {percent(total[selected[0]], total.gross)}</small></strong><span>{t("financialCenter.clickToOpen")}{viewLabel[selected[4]]}»</span></div></div>}
    </div>
  </Panel>;
}
function CompanyResult({ total, detailed = false, singleDriver = false }) {
  const { t } = useTranslation();

  return <Panel title={singleDriver ? t("financialCenter.companyResultFromThisDriverSTrips") : t("financialCenter.companyFinancialResult")} actions={<BarChart3 size={20} className="fc-muted" />} className="fc-company-result">
    <dl><div><dt><Coins size={14} className="fc-mint" />{t("financialCenter.companyCommissionCalculated")}</dt><dd>{money(total.company)}</dd></div><div><dt><Building2 size={14} />{t("financialCenter.recordedCompanyCosts")}</dt><dd>{money(total.operating)}</dd></div><div className="fc-result"><dt>{t("financialCenter.commissionLessCosts")}</dt><dd className={total.profit < 0 ? 'fc-negative' : 'fc-mint'}>{money(total.profit)}<small>{percent(total.profit, total.company)}{" "}{t("financialCenter.ofCommission")}</small></dd></div></dl>
    {detailed && <p className="fc-help">{t("financialCenter.costsComeFromEachLoadSAccounting")}</p>}
  </Panel>;
}
function CashFlow({ total }) {
  const { t } = useTranslation();
  const fields = [['additionalIncome', 'additionalIncome'], ['revenue', 'tripIncome'], ['brokerPaid', 'receivedFromBroker'], ['outstanding', 'outstandingFromBroker'], ['operating', 'recordedCompanyCosts'], ['tripBalance', 'tripBalance']];
  return <Panel title={t('financialCenter.cashFlow')} className="fc-cash-flow"><dl>{fields.map(([key, label]) => <div key={key}><dt>{t(`financialCenter.${label}`)}</dt><dd className={total[key] < 0 ? 'fc-negative' : ''}>{money(total[key])}</dd></div>)}</dl><p className="fc-help">{t('financialCenter.cashFlowBasis')}</p></Panel>;
}
function Trend({ daily, total, onDate }) {
  const { t } = useTranslation();

  daily = daily.filter(row => row.gross != null);
  const max = Math.max(1, ...daily.map(row => row.gross));
  const points = daily.map((row, i) => [4 + i / Math.max(1, daily.length - 1) * 492, 136 - row.gross / max * 124]);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  return <Panel title={t("financialCenter.grossRevenueTrend")} actions={<span className="fc-small">{t("financialCenter.total106")}{" "}{money(total.gross)}</span>} className="fc-trend">
    {daily.length ? <div className="fc-trend-chart"><div className="fc-chart-values">{[1, .5, 0].map(fraction => <span key={fraction}>{formatNumber(Math.round(max / 100 * fraction))}</span>)}</div>
      <svg viewBox="0 0 500 150" preserveAspectRatio="none" role="group" aria-label={t("financialCenter.revenueByDeliveryDate")}>
        {[0, 1, 2].map(i => <line key={i} x1="4" x2="496" y1={136 - i * 62} y2={136 - i * 62} />)}
        <path d={`${line} L${points.at(-1)[0]},136 L4,136 Z`} fill="var(--fc-chart-line)" opacity=".07" /><path d={line} fill="none" stroke="var(--fc-chart-line)" strokeWidth="2" />
        {points.map(([x, y], i) => <g key={daily[i].date} role="button" tabIndex={0} aria-label={t("financialCenter.countCountOpenLoadsForThisDay", { value0: dateLabel(daily[i].date), value1: money(daily[i].gross) })} className="fc-day-control" onClick={() => onDate(daily[i].date)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDate(daily[i].date); } }}><circle cx={x} cy={y} r="2.7" fill="var(--fc-chart-dot)" /><circle cx={x} cy={y} r="4" fill="transparent" stroke="transparent" strokeWidth="20" vectorEffect="non-scaling-stroke" /><title>{dateLabel(daily[i].date)}: {money(daily[i].gross)}{" "}{t("financialCenter.openLoads")}</title></g>)}
      </svg><div className="fc-chart-dates">{[...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])].map(i => <span key={daily[i].date}>{dateLabel(daily[i].date)}</span>)}</div></div> : <p className="fc-empty">{t("financialCenter.noDataForTheSelectedPeriod")}</p>}
  </Panel>;
}
function DriverTable({ drivers, total, selectedId, onSelect, title }) {
  const { t } = useTranslation();

  return <Panel title={title || t("financialCenter.driverPerformance")} actions={<span className="fc-small">{drivers.length}{" "}{t("financialCenter.drivers112")}{" "}{total.count}{" "}{t("financialCenter.trips113")}</span>} className="fc-driver-panel">
    <div className="fc-table-wrap"><table className="fc-table fc-driver-table"><thead><tr>{[t("financialCenter.driver"), t("financialCenter.truck"), t("financialCenter.trips"), t("financialCenter.grossRevenue"), t("financialCenter.company"), t("financialCenter.dispatcher"), t("financialCenter.otherDeductions"), t("financialCenter.driverNetPay")].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{drivers.map(driver => <tr key={driver.id} className={selectedId === driver.id ? 'is-selected' : ''}><td><button onClick={() => onSelect(driver.id)} aria-pressed={selectedId === driver.id}><UserRound size={14} />{driver.name}</button></td><td>{driver.truck}</td><td>{driver.count}</td>{amountKeys.map(key => <td key={key}>{money(driver[key])}</td>)}</tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={2}>{t("financialCenter.total")}</th><td>{total.count}</td>{amountKeys.map(key => <td key={key}>{money(total[key])}</td>)}</tr></tfoot>
    </table>{!drivers.length && <p className="fc-empty">{t("financialCenter.noDriversFoundChangeTheFilters")}</p>}</div>
  </Panel>;
}
function LoadTable({ rows, selected, onSelect, compact = false }) {
  const { t } = useTranslation();

  const columns = [t("financialCenter.grossRevenue"), t("financialCenter.company"), t("financialCenter.dispatcher"), t("financialCenter.otherDeductions"), t("financialCenter.netPay")];

  return <div className="fc-table-wrap"><table className={`fc-table fc-load-table ${compact ? 'is-compact' : ''}`}><thead><tr>{[t("financialCenter.trip"), t("financialCenter.route"), t("financialCenter.date"), ...(compact ? ['Gross', t("financialCenter.company"), t("financialCenter.dispatcher"), t("financialCenter.other"), 'Net'] : columns)].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={selected === row.id ? 'is-selected' : ''}><td><button className="fc-link" onClick={() => onSelect(row)} aria-label={t("financialCenter.openLoadStatementCount", { value0: row.number })}>{row.number}</button></td><td>{row.origin} → {row.destination}</td><td>{row.date ? dateLabel(row.date) : '—'}</td>{amountKeys.map(key => <td key={key}>{money(row[key])}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="fc-empty">{t("financialCenter.noLoadsFoundChangeTheFilters")}</p>}</div>;
}

export { Notice, Panel, Summary, Allocation, CompanyResult, CashFlow, Trend, DriverTable, LoadTable };
