import DatePicker from '../CalendarPicker';
import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import Statement from './Statement.jsx';
import { settlementDraft, reviewSettlement } from './settlementReviewModel.js';
import { useSettlementText } from './text';
import { usd } from '../finance/format';

const loadLabels = { loadNumber: 'number', originCity: 'pickupCity', destinationCity: 'deliveryCity', rate: 'gross', miles: 'miles', netOverride: 'loadNet' };

export default function SettlementPdfReview({ source, onClose, onApprove }) {
  const t = useSettlementText();
  const [snapshot, setSnapshot] = useState(source);
  const [draft, setDraft] = useState(() => settlementDraft(source));
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const approvingRef = useRef(false);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  async function approve(pdf) {
    if (approvingRef.current || active || snapshot.calculation.net < 0) return;
    approvingRef.current = true; setApproving(true); setApprovalError('');
    try { await onApprove(snapshot, pdf); }
    catch (err) {
      setApprovalError(t(/ALREADY_CONFIRMED/.test(err.message) ? 'alreadyCalculated' : /SETTINGS_CHANGED|LOAD_CHANGED/.test(err.message) ? 'approvalStale' : 'approvalFailed'));
    } finally { approvingRef.current = false; setApproving(false); }
  }
  const label = field => field.ruleId ? (field.ruleId.startsWith('custom_') ? snapshot.calculation.settings.rules.find(rule => rule.id === field.ruleId)?.label : t(field.ruleId))
    : t(field.loadIndex != null ? loadLabels[field.property] : { companyName: 'companyName', driverName: 'driver', period: 'calculationPeriod', netOverride: 'finalNet' }[field.key]);
  function open(field) {
    if (approvingRef.current) return;
    setDraft(settlementDraft(snapshot));
    setActive(field);
    setError('');
  }
  function save(event) {
    event.preventDefault();
    try {
      setSnapshot(reviewSettlement(source, draft));
      setActive(null);
      setError('');
    } catch (err) { setError(t(err.message)); }
  }
  const cancel = () => { setActive(null); setError(''); };
  const fieldEditor = field => <PdfFieldEditor key={String(field.page) + ':' + field.key} field={field} label={label(field)} draft={draft} setDraft={setDraft} calculation={snapshot.calculation} onSave={save} onCancel={cancel} error={error} t={t} />;
  const company = snapshot.calculation.settings.rules.find(rule => rule.id === 'company');
  const toolbar = <div className="ds-pdf-inline-toolbar">
    <span><Pencil size={15} />{t('inlinePdfHint')}</span>
    <div className="ds-pdf-inline-company"><button type="button" disabled={Boolean(active)} onClick={() => open({ key: 'rule:company', ruleId: 'company', toolbar: true })}>{t('company')}: {company.enabled ? company.method === 'percentage' ? company.value + '%' : usd(Number(company.value)) : t('disabled')}</button>
      {active?.toolbar && fieldEditor(active)}
    </div>
  </div>;
  const close = () => {
    if (approvingRef.current) return;
    const changed = active && JSON.stringify(draft) !== JSON.stringify(settlementDraft(snapshot));
    if (!changed || window.confirm(t('confirmDiscard'))) onClose();
  };
  return <Statement snapshot={snapshot} toolbar={toolbar} onClose={close} onEscape={active ? cancel : close}
    renderPageOverlay={fields => <>
      {fields.map(field => <button key={field.key} type="button" disabled={Boolean(active)} className="ds-pdf-hotspot" aria-label={t('editPdf') + ': ' + label(field) + (field.loadIndex != null ? ' · ' + snapshot.calculation.rows[field.loadIndex].load.loadNumber : '')} title={label(field)} style={{ left: field.x / 792 * 100 + '%', top: field.y / 612 * 100 + '%', width: field.width / 792 * 100 + '%', height: field.height / 612 * 100 + '%' }} onClick={() => open(field)} />)}
      {active && !active.toolbar && fields.some(field => field.key === active.key && field.page === active.page) && fieldEditor(active)}
    </>}
    onConfirm={approve} confirming={approving} confirmationError={approvalError}
    stalePreview={Boolean(active)} confirmDisabled={Boolean(active) || snapshot.calculation.net < 0}
    confirmHint={active ? t('inlinePdfFinish') : snapshot.calculation.net < 0 ? t('negative') : t('approvalHint')} />;
}

function PdfFieldEditor({ field, label, draft, setDraft, calculation, onSave, onCancel, error, t }) {
  const ref = useRef(null);
  useEffect(() => {
    const input = ref.current?.querySelector('input:not([type=checkbox]),select');
    input?.focus();
    if (input?.type !== 'date') input?.select?.();
  }, []);
  const change = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const changeLoad = (key, value) => setDraft(previous => ({ ...previous, loads: previous.loads.map((load, index) => index === field.loadIndex ? { ...load, [key]: value } : load) }));
  const changeRule = (key, value) => setDraft(previous => ({ ...previous, settings: { ...previous.settings, rules: previous.settings.rules.map(rule => rule.id === field.ruleId ? {
    ...rule, [key]: value,
    ...(key === 'method' && value === 'percentage' && !['per_load', 'per_settlement'].includes(rule.frequency) ? { frequency: 'per_settlement' } : {}),
  } : rule) } }));
  let inputs;
  if (field.ruleId) {
    const rule = draft.settings.rules.find(item => item.id === field.ruleId);
    inputs = <>
      <label className="ds-pdf-inline-checkbox"><input type="checkbox" checked={rule.enabled} onChange={event => changeRule('enabled', event.target.checked)} />{t('enabled')}</label>
      <label>{rule.method === 'percentage' ? '%' : 'USD'}<input type="number" min="0" max={rule.method === 'percentage' ? 100 : 9999999.99} step="0.01" required disabled={!rule.enabled} value={rule.value} onChange={event => changeRule('value', event.target.value)} /></label>
      <div className="ds-pdf-inline-pair"><label>{t('method')}<select value={rule.method} onChange={event => changeRule('method', event.target.value)}>{['fixed', 'percentage'].map(key => <option key={key} value={key}>{t(key)}</option>)}</select></label>
        <label>{t('frequency')}<select value={rule.frequency} onChange={event => changeRule('frequency', event.target.value)}>{(field.ruleId === 'company' || rule.method === 'percentage' ? ['per_load', 'per_settlement'] : ['per_load', 'per_settlement', 'weekly', 'monthly']).map(key => <option key={key} value={key}>{t(key)}</option>)}</select></label></div>
      {rule.method === 'percentage' && field.ruleId !== 'company' && <label>{t('basis')}<select value={rule.basis} onChange={event => changeRule('basis', event.target.value)}>{['gross', 'after_company'].map(key => <option key={key} value={key}>{t(key)}</option>)}</select></label>}
    </>;
  } else if (field.key === 'period') {
    inputs = <div className="ds-pdf-inline-pair">{['from', 'to'].map(key => <label key={key}>{t(key)}<DatePicker  required value={draft.period[key]} min={key === 'to' ? draft.period.from : undefined} max={key === 'from' ? draft.period.to : undefined} onChange={event => change('period', { ...draft.period, [key]: event.target.value })} /></label>)}</div>;
  } else {
    const load = field.loadIndex != null ? draft.loads[field.loadIndex] : null;
    const key = field.property || field.key;
    const numeric = ['rate', 'miles', 'netOverride'].includes(key);
    const row = load ? calculation.rows[field.loadIndex] : null;
    const automatic = row ? row.automaticNet ?? (row.gross - row.commission) : calculation.netBeforeOverride ?? calculation.net;
    inputs = <>
      <label>{label}{numeric && key !== 'miles' ? ' · USD' : ''}<input aria-label={label} type={numeric ? 'number' : 'text'} min={numeric ? '0' : undefined} max={numeric ? '9999999.99' : undefined} step={numeric ? '0.01' : undefined} maxLength={numeric ? undefined : key === 'companyName' || key.endsWith('City') ? 200 : 100} required={!['miles', 'netOverride', 'originCity', 'destinationCity'].includes(key)} value={load ? load[key] : draft[key]} placeholder={key === 'netOverride' ? (automatic / 100).toFixed(2) : undefined} onChange={event => load ? changeLoad(key, event.target.value) : change(key, event.target.value)} /></label>
      {key === 'netOverride' && <small>{t('netOverrideHint')}</small>}
      {['originCity', 'destinationCity'].includes(key) && <label>{t('state')}<input aria-label={t('state')} maxLength={200} value={load[key.replace('City', 'State')]} onChange={event => changeLoad(key.replace('City', 'State'), event.target.value)} /></label>}
    </>;
  }
  const style = field.toolbar ? undefined : {
    left: 'clamp(8px, ' + field.x / 792 * 100 + '%, calc(100% - 312px))',
    top: (field.y > 350 ? field.y : field.y + field.height) / 612 * 100 + '%',
    transform: field.y > 350 ? 'translateY(-100%)' : undefined,
  };
  return <form ref={ref} className="ds-pdf-inline-editor" style={style} onSubmit={onSave} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }} aria-label={t('editPdf') + ': ' + label}>
    <header><strong>{label}</strong><button type="button" onClick={onCancel} aria-label={t('close')}><X size={16} /></button></header>
    {inputs}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={onCancel}>{t('cancel')}</button><button type="submit" className="ds-primary"><Check size={15} />{t('applyPdfChanges')}</button></footer>
  </form>;
}
