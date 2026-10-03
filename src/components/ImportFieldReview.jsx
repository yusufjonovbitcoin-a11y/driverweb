import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { briefFieldLabel } from '../services/driverBrief';
import { FIELD_TYPES } from '../../supabase/functions/_shared/load-extraction-verification.ts';
import { localizedError } from '../i18n/errors';

export default function ImportFieldReview({ details, onCorrect, onBusy }) {
  const { t } = useTranslation();
  const [field, setField] = useState('loadNumber');
  const [value, setValue] = useState('');
  const [page, setPage] = useState('1');
  const [quote, setQuote] = useState('');
  const [absent, setAbsent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields = [...new Set([...details.fields.map(f => f.key), ...details.blockingFields, ...Object.keys(FIELD_TYPES),
    ...details.stops.flatMap((_,i) => Object.keys(FIELD_TYPES).filter(key=>key.startsWith('pickup.')).map(key=>key.replace('pickup.',`stops.${i}.`)))])]
    .filter(key => !['requirements', 'documentDetails', 'multiStopDriverWorkflow'].includes(key))
    .filter(key => !details.fields.some(f => f.key.startsWith('stops.')) || !/^(pickup|delivery)\./.test(key));
  function choose(key) {
    const item = details.fields.find(f => f.key === key) || details.issues.find(f => f.field === key);
    setField(key); setValue(item?.value == null ? '' : String(item.value));
    setPage(String(item?.page || 1)); setQuote(item?.quote || ''); setAbsent(false); setConfirmed(false);
  }
  async function save(event) {
    event.preventDefault(); if (busy || !confirmed) return;
    setError(''); setBusy(true); onBusy(true);
    try {
      const type = FIELD_TYPES[field.replace(/^stops\.\d+\./, 'pickup.')] || 'string';
      if (!absent && type === 'boolean' && !['true', 'false'].includes(value)) throw Error(t('importReview.booleanHint'));
      await onCorrect([{ field, value: absent ? null : ['number','integer'].includes(type) ? Number(value) : type === 'boolean' ? value === 'true' : value,
        page: Number(page), quote }]);
      setConfirmed(false);
    } catch (failure) { setError(String(failure.message).startsWith('PDF_')
      ? localizedError(t, failure, 'errors.documentAnalysis') : failure.message || t('errors.documentAnalysis')); }
    finally { setBusy(false); onBusy(false); }
  }
  return <details className="import-field-review">
    <summary>{t('importReview.reviewFields')}</summary>
    {details.issues.length > 0 && <ul className="import-review-issues">{details.issues.filter(item => !details.fields.some(f => f.key.startsWith('stops.')) || !/^(pickup|delivery)\./.test(item.field))
      .map(item => <li key={item.field}><button type="button" onClick={() => choose(item.field)}>{briefFieldLabel(t, item.field)}</button>
        <span>{t(`importReview.${item.status}`)} · {t(`importReview.${item.reason}`)}</span><p>{String(item.value ?? '')}</p></li>)}</ul>}
    {onCorrect && <form onSubmit={save}>
      <label>{t('importReview.field')}<select value={field} disabled={busy} onChange={e => choose(e.target.value)}>{fields.map(key => <option key={key} value={key}>{briefFieldLabel(t, key)}</option>)}</select></label>
      <label>{t('importReview.value')}<textarea value={value} disabled={busy || absent} required={!absent} maxLength={3500} onChange={e => { setValue(e.target.value); setConfirmed(false); }} /></label>
      <label className="import-inline-check"><input type="checkbox" checked={absent} disabled={busy} onChange={e => { setAbsent(e.target.checked); setConfirmed(false); }} />{t('importReview.absent')}</label>
      <label>{t('importReview.page')}<input type="number" min="1" step="1" required disabled={busy} value={page} onChange={e => { setPage(e.target.value); setConfirmed(false); }} /></label>
      <label>{t('importReview.quote')}<textarea required disabled={busy} maxLength={4000} value={quote} onChange={e => { setQuote(e.target.value); setConfirmed(false); }} /></label>
      <label className="import-inline-check"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{t('driverBrief.confirm')}</label>
      {error && <p role="alert">{error}</p>}
      <button className="import-button" disabled={busy || !confirmed}>{t(busy ? 'importReview.saving' : 'importReview.save')}</button>
    </form>}
  </details>;
}
