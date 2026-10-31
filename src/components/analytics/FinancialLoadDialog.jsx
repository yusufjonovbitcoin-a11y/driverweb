import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../../i18n/format';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, FileText, Pencil, Save, UserRound, X } from 'lucide-react';
import { accountingFields, accountingPayload, accountingPreview } from '../../services/tripAccounting.js';

const money = value => value == null ? '—' : formatCurrency(value / 100);

const initial = row => Object.fromEntries(accountingFields.map(key => [key, row.raw[key] == null ? '' : String(row.raw[key])]));
export default function FinancialLoadDialog({ row, onClose, onExport, onDriver, onOpenLoad, onSaveAccounting, canEdit }) {
  const { t } = useTranslation();

  const labels = { additional_income: t("financialCenter.additionalIncome"), driver_pay: t("financialCenter.recordedDriverPay"), fuel_cost: t("financialCenter.companyFuel"), toll_cost: t("financialCenter.companyTolls"), other_cost: t("financialCenter.otherCompanyExpenses"), broker_paid: t("financialCenter.receivedFromBroker") };

  const dialog = useRef(null);
  const [editing, setEditing] = useState(false), [values, setValues] = useState(() => initial(row));
  const [notes, setNotes] = useState(row.raw.notes || ''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftRow, setDraftRow] = useState(row.raw);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial({ raw: draftRow })) || notes !== (draftRow.notes || '');
  const changedElsewhere = editing && row.raw.accounting_version !== draftRow.accounting_version;
  function discard() { return !dirty || window.confirm(t('financialCenter.discardDraft')); }
  function close() { if (!saving && (!editing || discard())) onClose(); }
  function beginEdit() {
    setDraftRow(row.raw); setValues(initial(row)); setNotes(row.raw.notes || ''); setError(''); setEditing(true);
  }
  useEffect(() => {
    if (!editing || !dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, dirty]);
  let payload, preview;
  try {
    payload = accountingPayload(values);
    const approved = row.netSource === 'approved';
    preview = accountingPreview(draftRow.contract_amount, approved ? { ...values, driver_pay: '0' } : values);
    if (approved && preview.costs != null) {
      preview.costs += row.net / 100;
      preview.balance = preview.revenue == null ? null : preview.revenue - preview.costs;
    }
  } catch { /* Field validation is shown below. */ }
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); else document.querySelector('.fc-nav button[aria-current="page"]')?.focus(); };
  }, []);
  async function save(event) {
    event.preventDefault();
    if (!payload || saving || !canEdit || !dirty) return;
    if (changedElsewhere) { setError(t('financialCenter.thisRecordChangedCloseTheDialogRefresh')); return; }
    setSaving(true); setError('');
    try { const result = await onSaveAccounting(draftRow, payload, notes); setNotice(result?.refreshFailed ? t("financialCenter.accountingSavedCouldNotRefreshTheScreen") : ''); setEditing(false); }
    catch (failure) { setError(/ACCOUNTING_CONFLICT/.test(failure.message) ? t("financialCenter.thisRecordChangedCloseTheDialogRefresh") : /ACCOUNTING_PERMISSION|42501/.test(failure.message || failure.code) ? t("financialCenter.youDoNotHavePermissionToEdit") : t("financialCenter.couldNotSaveAccountingCheckYourConnection")); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="fc-dialog fc-financial-load-dialog" aria-labelledby="fc-load-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><div>
    <header><div><small>{t("financialCenter.tripFinancialDetails")}</small><h2 id="fc-load-title">{t("financialCenter.load132")}{row.number}</h2></div><button aria-label={t("financialCenter.closeStatement")} disabled={saving} onClick={close} autoFocus><X size={20} /></button></header>
    {row.netSource === 'approved' && <p className="fc-help">{t("financialCenter.approvedAllocation", { number: row.statementNumber })}</p>}
    {editing ? <form className="fc-load-editor" onSubmit={save}>
      <p className="fc-help">{t("financialCenter.anEmptyFieldMeansUnknownDataSaving")}</p>
      <fieldset className="fc-editor-fields" disabled={saving}>{accountingFields.map(key => <label key={key}>{labels[key]} · USD<input inputMode="decimal" autoComplete="off" maxLength={13} value={key === 'driver_pay' && row.netSource === 'approved' ? (row.net / 100).toFixed(2) : values[key]} disabled={key === 'driver_pay' && row.netSource === 'approved'} placeholder={t("financialCenter.notSpecified")} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}<label className="fc-editor-notes">{t("financialCenter.notes")}<textarea value={notes} maxLength={2000} rows={3} onChange={event => setNotes(event.target.value)} /></label></fieldset>
      {!payload && <p role="alert" className="fc-negative">{t("financialCenter.enterNonNegativeAmountsWithUpTo")}</p>}
      {preview && <dl className="fc-edit-preview">{[[t("financialCenter.tripIncome"), preview.revenue], [t("financialCenter.tripCosts"), preview.costs], [t("financialCenter.accountingBalance"), preview.balance], [t("financialCenter.outstandingFromBroker"), preview.outstanding]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value == null ? null : Math.round(value * 100))}</dd></div>)}</dl>}
      {error && <p role="alert" className="fc-negative">{error}</p>}
      {changedElsewhere && <p role="alert" className="fc-negative">{t('financialCenter.draftChangedElsewhere')} <button type="button" onClick={() => { if (discard()) beginEdit(); }}>{t('financialCenter.reloadLatest')}</button></p>}
      <div className="fc-dialog-actions"><button type="button" disabled={saving} onClick={() => { if (discard()) setEditing(false); }}>{t("financialCenter.cancel")}</button><button type="submit" disabled={saving || changedElsewhere || !payload || !dirty}><Save size={16} />{saving ? t("financialCenter.saving") : t("financialCenter.saveAccounting")}</button></div>
    </form> : <>
      <div className="fc-route"><span>{row.origin}</span><ArrowRight size={20} /><span>{row.destination}</span></div>
      <p className="fc-help">{row.driverName} · {row.truck} · {row.date || t("financialCenter.noDateSpecified")} · {row.miles == null ? t("financialCenter.noMileageSpecified") : `${formatNumber(row.miles)} mi`}</p>
      <dl>{[[t(row.netSource === "approved" ? "financialCenter.approvedGross" : "financialCenter.grossFromLoadRate"), row.gross], [t("financialCenter.contractGross"), row.contractGross], [t("financialCenter.companyCommission"), row.company], [t("financialCenter.dispatcherCommission"), row.dispatch], [t("financialCenter.otherDeductions"), row.other], [t("financialCenter.driverNetPay"), row.net], [t("financialCenter.unallocated"), row.adjustment], [t("financialCenter.companyCosts069"), row.operating], [t("financialCenter.companyResult"), row.profit], [t("financialCenter.additionalIncome"), row.additionalIncome], [t("financialCenter.tripIncome"), row.revenue], [t("financialCenter.receivedFromBroker"), row.brokerPaid], [t("financialCenter.outstandingFromBroker"), row.outstanding], [t("financialCenter.tripBalance"), row.tripBalance]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
      <p className="fc-help">{t("financialCenter.driverPay150")}{" "}{t(`financialCenter.paySource.${row.netSource}`)}{t("financialCenter.unknownAmountsAreShownAs")}</p>
      {notice && <p className="fc-help" role="status">{notice}</p>}
      <div className="fc-dialog-actions">{canEdit && <button onClick={beginEdit}><Pencil size={16} />{t("financialCenter.costAccounting")}</button>}{onOpenLoad && <button onClick={() => onOpenLoad(row.id)}><FileText size={16} />{t("financialCenter.loadDocuments")}</button>}<button disabled={!onExport} onClick={() => onExport?.(row)}><Download size={16} />{t("financialCenter.loadCsv")}</button>{onDriver && row.driverId !== 'unassigned' && <button onClick={() => onDriver(row.driverId)}><UserRound size={16} />{t("financialCenter.showDriver")}</button>}</div>
      <p className="fc-notice">{t("financialCenter.thisStatementIsNotAPaymentConfirmation")}</p>
    </>}
  </div></dialog>;
}
