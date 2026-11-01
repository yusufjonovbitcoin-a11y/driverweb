import { useEffect, useId, useRef, useState } from 'react';
import { CircleCheck, FileCheck2, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DatePicker from './CalendarPicker.jsx';
import { displayDayKey, formatTimeZoneClock, timeZonePreference } from '../i18n/timeZone.js';
import { completionErrorKey } from '../services/staffLoadCompletion.js';
import './staff-load-completion.css';

export default function StaffLoadCompletion({ load, evidence, onComplete }) {
  const { t } = useTranslation();
  const dialog = useRef(null);
  const busyRef = useRef(false);
  const attempt = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);
  const [zone] = useState(() => load.destination?.timezone || timeZonePreference.getSnapshot());
  const [date, setDate] = useState(() => displayDayKey(new Date(), zone));
  const [time, setTime] = useState(() => formatTimeZoneClock(new Date(), zone));
  const [note, setNote] = useState('');
  const id = useId();
  const alive = useRef(true);
  useEffect(() => { const node = dialog.current; alive.current = true; return () => { alive.current = false; node?.close(); }; }, []);
  if (!onComplete || finished) return null;

  function open() {
    setError('');
    dialog.current.showModal();
  }
  async function submit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!evidence || !date || !time) { setError('documentsError'); return; }
    const payload = { versionIds: evidence.versionIds, deliveredLocal: `${date}T${time}:00`, timeZone: zone, note: note.trim() };
    const signature = JSON.stringify([load.currentAssignmentId, load.version, payload]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, operationId: crypto.randomUUID() };
    busyRef.current = true; setBusy(true); setError('');
    try {
      await onComplete(load, { ...payload, operationId: attempt.current.operationId });
      if (alive.current) { dialog.current?.close(); setFinished(true); }
    } catch (cause) {
      if (alive.current) setError(completionErrorKey(cause));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <>
    {evidence ? <button type="button" className="staff-completion-trigger" onClick={open}><CircleCheck size={17} aria-hidden="true" />{t('staffCompletion.action')}</button> : null}
    <dialog ref={dialog} className="staff-completion-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.stopPropagation(); if (busyRef.current) event.preventDefault(); }}>
      <form onSubmit={submit}>
        <header><div><span className="staff-completion-symbol"><FileCheck2 size={21} aria-hidden="true" /></span><div><h2 id={`${id}-title`}>{t('staffCompletion.title')}</h2><p>{load.brokerLoadNumber || load.loadNumber} · {load.internalNumber ? `#${load.internalNumber}` : load.driverId}</p></div></div>
          <button type="button" className="staff-completion-close" disabled={busy} aria-label={t('common.close')} onClick={() => dialog.current.close()}><X size={19} /></button></header>
        <div className="staff-completion-body">
          <p className="staff-completion-copy">{t('staffCompletion.description')}</p>
          <div className="staff-completion-evidence"><CircleCheck size={17} aria-hidden="true" /><span>{t('staffCompletion.documentsReady', { count: evidence?.documents.length || 0 })}</span></div>
          <fieldset disabled={busy}>
            <div className="staff-completion-fields"><label>{t('staffCompletion.deliveryDate')}<DatePicker value={date} onChange={event => setDate(event.target.value)} required name="deliveryDate" /></label>
              <label>{t('staffCompletion.deliveryTime')}<input type="time" name="deliveryTime" required value={time} onChange={event => setTime(event.target.value)} /></label></div>
            <label>{t('staffCompletion.note')}<textarea value={note} maxLength={2000} rows={2} onChange={event => setNote(event.target.value)} /></label>
          </fieldset>
          <p className="staff-completion-pay-note">{t('staffCompletion.payNote')}</p>
          {error ? <p role="alert" className="staff-completion-error">{t(`staffCompletion.${error}`)}</p> : null}
        </div>
        <footer><button type="button" disabled={busy} onClick={() => dialog.current.close()}>{t('common.cancel')}</button>
          <button type="submit" className="is-primary" disabled={busy || !evidence}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <CircleCheck size={17} />}{t(busy ? 'staffCompletion.saving' : 'staffCompletion.confirm')}</button></footer>
      </form>
    </dialog>
  </>;
}
