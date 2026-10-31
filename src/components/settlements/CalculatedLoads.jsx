import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FileText, CheckCircle2, Search } from 'lucide-react';
import { usd, day, deductionMoney } from '../finance/format';
import { useSettlementText } from './text';
import AccountingDateFilter from '../AccountingDateFilter';
import { calculatedInRange, calculatedStatementSnapshot } from './calculatedLoads.js';
import { timeZonePreference } from '../../i18n/timeZone.js';
import { place } from './calculation.js';
import CalculatedSettlementPage from './CalculatedSettlementPage.jsx';
import Statement from './Statement.jsx';

export default function CalculatedLoads({ entries, readEntry, pdfLoader, onOpenLoad, canSendToDriver = false }) {
  const t = useSettlementText();
  const [query, setQuery] = useState('');
  const [driver, setDriver] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [pdfSnapshot, setPdfSnapshot] = useState(null);
  const listRef = useRef(null);
  const zone = useSyncExternalStore(timeZonePreference.subscribe, timeZonePreference.getSnapshot, timeZonePreference.getSnapshot);
  const reference = entry => entry.reference || `#${String(entries.length - entries.indexOf(entry)).padStart(4, '0')}`;
  const selectedEntry = entries.find(entry => entry.id === selectedId);
  const shown = entries.filter(entry => (!driver || entry.driver.id === driver)
    && calculatedInRange(entry, range, zone)
    && [reference(entry), entry.driver.name, ...entry.calculation.rows.flatMap(row => [row.load.loadNumber, place(row.load.origin), place(row.load.destination)])].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const totals = shown.reduce((sum, entry) => ({
    loads: sum.loads + entry.calculation.rows.length,
    gross: sum.gross + entry.calculation.gross,
    deductions: sum.deductions + entry.calculation.gross - entry.calculation.net,
    net: sum.net + entry.calculation.net,
  }), { loads: 0, gross: 0, deductions: 0, net: 0 });
  const drivers = [...new Map(entries.map(entry => [entry.driver.id, entry.driver])).values()];
  function backToList() {
    setSelectedId(null);
    requestAnimationFrame(() => {
      const row = [...(listRef.current?.querySelectorAll('[data-calculation-id]') || [])].find(item => item.dataset.calculationId === selectedId);
      (row?.querySelector('button') || listRef.current)?.focus();
    });
  }
  if (selectedEntry) return <ResolvedSettlement key={selectedEntry.id} entry={selectedEntry} readEntry={readEntry} onClose={backToList}>{entry => <CalculatedSettlementPage entry={entry} reference={reference(selectedEntry)} onBack={backToList} onOpenLoad={onOpenLoad} />}</ResolvedSettlement>;
  return <div className="ds-calculated" ref={listRef} tabIndex={-1}>
    <div className="ds-history-tools"><label className="ds-history-search"><Search size={16} /><span className="sr-only">{t('historySearch')}</span><input type="search" value={query} placeholder={t('historySearch')} onChange={event => setQuery(event.target.value)} /></label><div className="ds-history-filters"><label><span className="sr-only">{t('driver')}</span><select value={driver} onChange={event => setDriver(event.target.value)}><option value="">{t('allDrivers')}</option>{drivers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><AccountingDateFilter value={range} onChange={setRange} label={t('calculatedOn')} /></div></div>
    <p className="ds-history-note">{t('historySessionNote')}</p>
    <div className="ds-history-summary">{[['calculationCount', shown.length], ['gross', usd(totals.gross / 100)], ['deductionsPdf', usd(totals.deductions / 100)], ['net', usd(totals.net / 100)]].map(([key, value]) => <div key={key}><span>{t(key)}</span><strong>{value}</strong>{key === 'calculationCount' && <small>{t('calculatedLoads')}: {totals.loads}</small>}</div>)}</div>
    {!shown.length ? <div className="ds-panel ds-history-empty"><CheckCircle2 size={30} /><h2>{t('historyEmpty')}</h2><p>{t(entries.length ? 'historyNoMatches' : 'historyHelp')}</p></div>
      : <section className="ds-panel ds-history-list"><p className="ds-history-note">{t('historyBatchHint')}</p><div className="ds-table-scroll"><table className="ds-load-table"><caption className="sr-only">{t('historyBatchHint')}</caption><thead><tr>{['calculationRef', 'driver', 'calculationPeriod', 'loadCount', 'gross', 'deductionsPdf', 'net', 'calculatedOn', 'pdfDocument'].map(key => <th scope="col" key={key}>{t(key)}</th>)}</tr></thead><tbody>
        {shown.map(entry => <tr key={entry.id} data-calculation-id={entry.id} tabIndex={0} aria-label={`${t('openCalculation')} ${reference(entry)} · ${entry.driver.name}`} onClick={event => { if (!event.target.closest('button, a')) setSelectedId(entry.id); }} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); setSelectedId(entry.id); } }}>
          <td><button type="button" className="ds-link" onClick={() => setSelectedId(entry.id)}>{reference(entry)}</button></td>
          <td><strong>{entry.driver.name}</strong><small className="ds-batch-status">{t(entry.approvalStatus === 'approved' ? 'approvedCalculation' : 'calculatedDraft')}</small></td>
          <td className="ds-batch-period"><span>{day(entry.calculation.period.from)}</span><span>— {day(entry.calculation.period.to)}</span></td>
          <td>{entry.calculation.rows.length}</td><td className="ds-batch-money">{usd(entry.calculation.gross / 100)}</td><td className="ds-batch-money">{deductionMoney(entry.calculation.gross - entry.calculation.net)}</td><td className="ds-batch-money ds-batch-net">{usd(entry.calculation.net / 100)}</td><td>{day(entry.calculatedAt)}</td>
          <td><button type="button" className="ds-link ds-batch-open" aria-label={`${t('openPdf')} ${reference(entry)}`} onClick={() => setPdfSnapshot(entry)}><FileText size={18} />{t('pdfDocument')}</button></td>
        </tr>)}
      </tbody><tfoot><tr><td colSpan={3}>{t('total')}: {shown.length}</td><td>{totals.loads}</td><td>{usd(totals.gross / 100)}</td><td>{deductionMoney(totals.deductions)}</td><td>{usd(totals.net / 100)}</td><td colSpan={2} /></tr></tfoot></table></div></section>}
    {pdfSnapshot && <ResolvedSettlement key={pdfSnapshot.id} entry={pdfSnapshot} readEntry={readEntry} onClose={() => setPdfSnapshot(null)}>{entry => <Statement snapshot={calculatedStatementSnapshot(entry)} pdfLoader={pdfLoader} canSendToDriver={canSendToDriver} onClose={() => setPdfSnapshot(null)} />}</ResolvedSettlement>}
  </div>;
}

function ResolvedSettlement({ entry, readEntry, onClose, children }) {
  const t = useSettlementText();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const needsRead = entry.persisted && !entry.complete;
  useEffect(() => {
    if (!needsRead) return;
    const controller = new AbortController();
    Promise.resolve().then(() => readEntry(entry.id, controller.signal))
      .then(value => { if (!controller.signal.aborted) setResult({ attempt, value }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ attempt, error: true }); });
    return () => controller.abort();
  }, [entry.id, needsRead, readEntry, attempt]);
  if (!needsRead) return children(entry);
  if (result?.attempt === attempt && result.value) return children(result.value);
  return <div className="ds-panel"><button type="button" className="ds-link" onClick={onClose}>{t('backToCalculations')}</button>{result?.attempt === attempt && result.error
    ? <div role="alert">{t('loadError')} <button type="button" onClick={() => setAttempt(n => n + 1)}>{t('retry')}</button></div>
    : <p role="status">{t('loading')}</p>}</div>;
}
