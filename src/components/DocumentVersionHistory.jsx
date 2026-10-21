import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, History, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../i18n/format';
import { loadStaffDocumentHistory } from '../services/staffLoadDocumentService.js';

export default function DocumentVersionHistory({ document, onClose, inline = false }) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef(null);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ rows: [], loading: true, error: false, more: false });
  useEffect(() => {
    if (inline) return;
    const previous = window.document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, [inline]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    loadStaffDocumentHistory(document.documentId, controller.signal, offset).then(rows => {
      if (active) setState(previous => ({ rows: offset ? [...previous.rows, ...rows] : rows, loading: false, error: false, more: rows.length === 20 }));
    }).catch(() => {
      if (active) setState(previous => ({ ...previous, loading: false, error: true }));
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [document.documentId, offset, attempt]);
  const content = <>
    <header><div>{!inline && <History size={20} aria-hidden="true" />}<h3 id={`${id}-title`}>{t('documentWorkspace.versionHistory')}</h3></div>{!inline && <button type="button" aria-label={t('common.close')} onClick={onClose}><X size={20} /></button>}</header>
    {!inline && <p>{document.title} · {document.fileName}</p>}
    <ol>{state.rows.map(row => <li key={row.id}><span className="document-history-number">v{row.version_number}</span><div><strong>{row.file_name}</strong><time dateTime={row.uploaded_at}>{formatDateTime(row.uploaded_at)}</time></div>{row.id === document.versionId && <span className="document-history-current"><CheckCircle2 size={14} aria-hidden="true" />{t('documentWorkspace.currentVersion')}</span>}</li>)}</ol>
    {state.loading ? <p role="status"><LoaderCircle className="animate-spin" size={16} />{t('documentManagement.loading')}</p> : state.error ? <p role="alert">{t('documentWorkspace.historyError')}</p> : !state.rows.length ? <p>{t('documentWorkspace.noHistory')}</p> : null}
    {!state.loading && (state.error || state.more) && <button type="button" className="document-history-more" onClick={() => { setState(previous => ({ ...previous, loading: true, error: false })); if (state.error) setAttempt(value => value + 1); else setOffset(state.rows.length); }}>{t(state.error ? 'documentManagement.retry' : 'documentWorkspace.moreVersions')}</button>}
  </>;
  return inline ? <section className="document-history-inline" aria-labelledby={`${id}-title`}>{content}</section>
    : <dialog ref={dialog} className="document-history-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>{content}</dialog>;
}
