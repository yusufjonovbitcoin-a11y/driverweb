import { useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { usd, day, deductionMoney } from '../finance/format';
import { place } from './calculation.js';
import { useSettlementText } from './text';

export default function CalculatedSettlementPage({ entry, reference, onBack, onOpenLoad }) {
  const t = useSettlementText();
  const heading = useRef(null);
  const c = entry.calculation;
  const companyRule = c.settings.rules.find(rule => rule.id === 'company');
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest('.workspace-main')?.scrollTo({ top: 0 });
  }, [entry.id]);
  return <section className="ds-calculated ds-settlement-detail" aria-labelledby="calculated-detail-title">
    <button type="button" className="ds-link ds-batch-back" onClick={onBack}><ArrowLeft size={16} />{t('backToCalculations')}</button>
    <header className="ds-batch-detail-heading"><div><h1 ref={heading} tabIndex={-1} id="calculated-detail-title">{t('calculationRef')} {reference}</h1><p>{entry.driver.name} · {day(c.period.from)} — {day(c.period.to)}</p></div><span className="ds-history-badge"><CheckCircle2 size={14} />{t(entry.approvalStatus === 'approved' ? 'approvedCalculation' : 'calculatedDraft')}</span></header>
    <div className="ds-history-summary">{[['gross', c.gross], ['company', c.commission], ['deducted', c.deducted], ...(c.loadNetAdjustment ? [['loadNetAdjustment', c.loadNetAdjustment]] : []), ['net', c.net]].map(([key, value]) => <div key={key}><span>{t(key)}</span><strong>{usd(value / 100)}</strong></div>)}</div>
    <section className="ds-panel ds-history-entry"><header><h2>{t('loadsInCalculation')} ({c.rows.length})</h2></header><div className="ds-table-scroll"><table className="ds-load-table"><thead><tr>{['number', 'route', 'date', 'miles', 'gross', 'company', 'earnings'].map(key => <th scope="col" key={key}>{t(key)}</th>)}</tr></thead><tbody>{c.rows.map(row => <tr key={row.load.id}><td>{!onOpenLoad ? row.load.loadNumber : <button type="button" className="ds-link" onClick={() => onOpenLoad(row.load)}>{row.load.loadNumber}</button>}</td><td>{place(row.load.origin)} → {place(row.load.destination)}</td><td>{day(row.load.deliveredAt)}</td><td>{row.miles ?? '—'}</td><td>{usd(row.gross / 100)}</td><td>−{usd(row.commission / 100)}</td><td>{usd((row.net ?? (row.gross - row.commission)) / 100)}{Boolean(row.netAdjustment) && <small>{t('loadNetAdjustment')}: {usd(row.netAdjustment / 100)}</small>}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>{t('total')}</td><td>{c.miles ?? '—'}</td><td>{usd(c.gross / 100)}</td><td>−{usd(c.commission / 100)}</td><td>{usd(c.earnings / 100)}</td></tr></tfoot></table></div><small>{t('historyEarningsNote')}</small></section>
    <section className="ds-panel"><h2>{t('deductionsPdf')}</h2><div className="ds-table-scroll"><table className="ds-load-table"><thead><tr><th scope="col">{t('item')}</th><th scope="col">{t('method')}</th><th scope="col">{t('frequency')}</th><th scope="col">{t('value')}</th></tr></thead><tbody><tr><td>{t('company')}</td><td>{t(companyRule.method)}</td><td>{t(companyRule.frequency)}</td><td>−{usd(c.commission / 100)}</td></tr>{Boolean(c.loadNetAdjustment) && <tr><td>{t('loadNetAdjustment')}</td><td>{t('fixed')}</td><td>{t('per_load')}</td><td>{deductionMoney(-c.loadNetAdjustment)}</td></tr>}{c.deductions.map(rule => <tr key={rule.id}><td>{rule.id.startsWith('custom_') ? rule.label : t(rule.id)}</td><td>{rule.method === 'percentage' ? `${rule.value}% · ${t(rule.basis)}` : t('fixed')}</td><td>{t(rule.frequency)}</td><td>{deductionMoney(rule.amount)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>{t('total')}</td><td>{deductionMoney(c.gross - c.net)}</td></tr></tfoot></table></div></section>
    <div className="ds-batch-final"><span>{t('net')}</span><strong>{usd(c.net / 100)}</strong></div>
    <p className="ds-history-note">{t('calculatedOn')}: {day(entry.calculatedAt)} · {t('settingsVersion')} {entry.settingsVersion} · {t('draft')}</p>
  </section>;
}
