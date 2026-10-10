import { useEffect, useId, useRef, useState } from 'react';
import { Eye, FilePlus2, LoaderCircle, RefreshCw, Replace, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DraggableLoadDocument from './DraggableLoadDocument.jsx';
import { loadStaffDocumentContext } from '../services/staffLoadDocumentService.js';

import { managedDocumentTypes as types, documentPermissionDenied as permissionDenied,
  documentMutationError, documentUploadError, documentChoices, documentViewerLoad, documentActionSnapshot } from './loadDocumentsModel.js';

export default function LoadDocumentsManager({ load, documents, onOpenDocs, onManageDocument }) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [hydration, setHydration] = useState({ key: null, context: null, error: false });
  const alive = useRef(true);
  const canManage = Boolean(onManageDocument && !load.trashedAt);
  const signature = JSON.stringify([load.version, documents.map(document => [document.id, document.versionId || document.url]),
    load.documentItems?.map(row => [row.id, row.current_version_id])]);
  const requestKey = `${load.id}:${signature}:${revision}`;
  const loading = canManage && hydration.key !== requestKey;
  const error = canManage && !loading && hydration.error;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!canManage) return;
    let disposed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    loadStaffDocumentContext(load.id, controller.signal).then(context => {
      if (!disposed) setHydration({ key: requestKey, context, error: false });
    }).catch(cause => {
      if (!disposed) setHydration(previous => ({ ...previous, context: permissionDenied(cause) ? null : previous.context, key: requestKey, error: true }));
    }).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [canManage, load.id, requestKey]);

  const manage = async (reviewedLoad, action) => {
    let row;
    try { row = await onManageDocument(reviewedLoad, action); }
    catch (cause) {
      if (alive.current && permissionDenied(cause)) setHydration({ key: requestKey, context: null, error: true });
      throw cause;
    }
    if (alive.current) {
      // A committed mutation is a success even if the subsequent read fails.
      if (row?.id) setHydration(previous => previous.context ? { ...previous, context: { ...previous.context,
        documentItems: [...previous.context.documentItems.filter(item => item.id !== row.id), row],
      } } : previous);
      setRevision(value => value + 1);
    }
    return row;
  };

  const context = canManage ? hydration.context : null;
  return <div className="load-document-manager">
    {canManage ? <div className="load-document-manager-toolbar">
      <p><ShieldCheck size={14} aria-hidden="true" />{t('documentManagement.historyHint')}</p>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label={t('documentManagement.refresh')}>
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />{t('common.refresh')}
      </button>
    </div> : null}
    {loading ? <p role="status" className="load-document-manager-note"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t('documentManagement.loading')}</p> : null}
    {error ? <p role="alert" className="load-document-error">{t(context ? 'documentManagement.refreshError' : 'documentManagement.loadError')}</p> : null}
    {canManage && !context ? <div className="load-document-grid" aria-busy={loading}>
      {documents.map(document => <article key={document.id} className="load-document-card load-document-skeleton"><h4>{document.title}</h4><p>{t(loading ? 'documentManagement.loading' : 'documentManagement.unavailable')}</p></article>)}
    </div> : <div className="load-document-grid">
      {documents.map(document => <DocumentSlot key={`${load.id}:${document.id}`} load={load} base={document}
        choices={documentChoices(document, context)} onOpenDocs={onOpenDocs}
        onManageDocument={canManage && !loading && !error ? manage : null} />)}
    </div>}
    {canManage ? <p className="load-document-manager-footnote">{t('documentManagement.replaceHint')}</p> : null}
  </div>;
}

export function DocumentSlot({ load, base, choices, onOpenDocs, onManageDocument }) {
  const { t } = useTranslation();
  const selectId = useId();
  const [selectedKey, setSelectedKey] = useState(() => choices.find(choice => choice.document.versionId === base.versionId && base.versionId)?.key || choices[0].key);
  const choice = choices.find(item => item.key === selectedKey) || choices[0];
  const document = choice.document;
  const stopLabel = stop => t('documentManagement.stopOption', { number: stop.sequence,
    place: [stop.facility_name || stop.city, stop.region].filter(Boolean).join(', ') || stop.address_line || t('common.notProvided') });
  return <div className="load-document-slot">
    {choices.length > 1 ? <label className="load-document-stop" htmlFor={selectId}>
      <span>{t(base.id === 'shipperBol' ? 'documentManagement.pickupStop' : 'documentManagement.deliveryStop')}</span>
      <select id={selectId} value={choice.key} onChange={event => setSelectedKey(event.target.value)}>
        {choices.map(item => <option key={item.key} value={item.key}>{item.legacy
          ? `${t('documentManagement.loadLevel')} · ${item.document.fileName || t('documentManagement.savedFile')}`
          : item.add ? `${t('documentManagement.add')} · ${stopLabel(item.stop)}`
            : `${stopLabel(item.stop)} · ${item.document.fileName || t('documentManagement.savedFile')}`}</option>)}
      </select>
    </label> : choice.stop ? <p className="load-document-stop-summary">{stopLabel(choice.stop)}</p> : null}
    <DocumentCard key={`${load.id}:${choice.key}:${document.versionId || document.url || ''}`} load={load} document={document}
      onOpen={() => onOpenDocs(document === base ? load : documentViewerLoad(load, document), document.id)}
      onManageDocument={!choice.missingStop && types[document.id] ? onManageDocument : null}
      missingStop={choice.missingStop} replaceAllowed={!choice.legacy} />
  </div>;
}

function DocumentCard({ load, document, onOpen, onManageDocument, missingStop, replaceAllowed }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null), fileRef = useRef(null), cancelRef = useRef(null);
  const alive = useRef(true), busyRef = useRef(false), pendingAction = useRef(null), selection = useRef(null), requestId = useRef(0);
  const [state, setState] = useState({ busy: false, progress: null, error: null, action: null });
  useEffect(() => { alive.current = true; return () => { alive.current = false; requestId.current += 1; }; }, []);
  const createAction = action => documentActionSnapshot(load, document, action);
  const run = async () => {
    if (busyRef.current || !pendingAction.current || !onManageDocument) return;
    busyRef.current = true; const token = ++requestId.current;
    const { reviewedLoad, ...action } = pendingAction.current;
    setState({ busy: true, progress: null, error: null, action: action.action });
    try {
      await onManageDocument(reviewedLoad, { ...action, onProgress: value => {
        if (alive.current && requestId.current === token && Number.isFinite(value)) {
          setState(current => ({ ...current, progress: Math.min(100, Math.max(0, value)) }));
        }
      } });
      if (alive.current && requestId.current === token) {
        pendingAction.current = null; dialogRef.current?.close();
        setState({ busy: false, progress: null, error: null, action: null });
      }
    } catch (cause) {
      if (alive.current && requestId.current === token) setState(current => ({ ...current, busy: false, error: documentMutationError(cause) }));
    } finally { if (requestId.current === token) busyRef.current = false; }
  };
  const chooseFile = () => {
    if (busyRef.current || (document.available && !replaceAllowed)) return;
    selection.current = createAction('upload');
    fileRef.current?.click();
  };
  const selectedFile = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busyRef.current || !alive.current) return;
    const error = documentUploadError(file);
    if (error) { pendingAction.current = null; setState({ busy: false, progress: null, error, action: null }); return; }
    pendingAction.current = { ...(selection.current || createAction('upload')), file };
    void run();
  };
  const confirmRemove = () => {
    if (busyRef.current) return;
    pendingAction.current = createAction('remove');
    setState({ busy: false, progress: null, error: null, action: 'remove' });
    dialogRef.current?.showModal(); cancelRef.current?.focus();
  };
  return <>
    <DocumentCardView document={document} state={state} editable={Boolean(onManageDocument)} missingStop={missingStop} replaceAllowed={replaceAllowed}
      onOpen={onOpen} onChooseFile={chooseFile} onRemove={confirmRemove}
      onRetry={state.action === 'upload' && ['saveError', 'timeoutError', 'busyError'].includes(state.error) ? run : null} />
    {onManageDocument ? <input ref={fileRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
      aria-label={t('documentManagement.chooseFile', { document: document.title })} onChange={selectedFile} /> : null}
    <DocumentRemovalDialog dialogRef={dialogRef} cancelRef={cancelRef} document={document} state={state}
      onCancel={() => dialogRef.current?.close()} onConfirm={event => { event.preventDefault(); void run(); }} />
  </>;
}

export function DocumentCardView({ document, state, editable, missingStop, replaceAllowed = true, onOpen, onChooseFile, onRemove, onRetry }) {
  const { t } = useTranslation();
  const id = useId();
  const canEdit = Boolean(editable && types[document.id]);
  const format = document.mimeType === 'application/pdf' ? 'PDF' : document.mimeType === 'image/jpeg' ? 'JPEG'
    : document.mimeType === 'image/png' ? 'PNG' : null;
  const status = state.action === 'remove' ? 'removing' : state.progress === 100 ? 'saving' : 'uploading';
  return <article className={`load-document-card${document.available ? ' is-present' : ' is-missing'}`} aria-label={document.title} aria-busy={state.busy}>
    <div className="load-document-preview" inert={state.busy}><DraggableLoadDocument document={document} onOpen={onOpen} /></div>
    <div className="load-document-file">
      {document.available ? <><p className="load-document-filename">{document.fileName || t('documentManagement.filenameUnavailable')}</p>
        {format ? <span className="load-document-format">{format}</span> : null}</>
        : <p className="load-document-empty">{t(canEdit ? 'documentManagement.emptyHint' : 'documents.notUploaded')}</p>}
    </div>
    {state.busy ? <div className="load-document-progress" role="status">
      <span><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t(`documentManagement.${status}`)}{state.progress != null && state.action === 'upload' ? ` ${Math.round(state.progress)}%` : ''}</span>
      <progress max="100" value={state.progress ?? undefined} aria-label={t(`documentManagement.${status}`)} />
    </div> : null}
    {state.error && state.action !== 'remove' ? <div className="load-document-error" id={`${id}-error`} role="alert">
      <p>{t(`documentManagement.${state.error}`)}</p>
      {onRetry ? <button type="button" onClick={() => void onRetry()}><RefreshCw size={14} aria-hidden="true" />{t('documentManagement.retry')}</button> : null}
    </div> : null}
    {missingStop ? <p className="load-document-empty">{t('documentManagement.stopUnavailable')}</p> : null}
    {canEdit && !replaceAllowed ? <p className="load-document-empty mb-3">{t('documentManagement.legacyReplaceHint')}</p> : null}
    <div className="load-document-actions">
      {document.available ? <button type="button" className="load-document-view" onClick={onOpen} disabled={state.busy}
        aria-label={t('documentManagement.viewDocument', { document: document.title })}><Eye size={15} aria-hidden="true" />{t('documentManagement.view')}</button> : null}
      {canEdit ? <>
        <button type="button" className={document.available ? 'load-document-replace' : 'load-document-add'} onClick={onChooseFile} disabled={state.busy || (document.available && !replaceAllowed)}
          aria-label={t(document.available ? 'documentManagement.replaceDocument' : 'documentManagement.addDocument', { document: document.title })}>
          {document.available ? <Replace size={15} aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}{t(document.available ? 'documentManagement.replace' : 'documentManagement.add')}
        </button>
        {document.available ? <button type="button" className="load-document-remove" onClick={onRemove} disabled={state.busy}
          aria-label={t('documentManagement.removeDocument', { document: document.title })} title={t('documentManagement.removeDocument', { document: document.title })}><Trash2 size={16} aria-hidden="true" /></button> : null}
      </> : <span className="load-document-readonly">{t('documentManagement.viewOnly')}</span>}
    </div>
  </article>;
}

export function DocumentRemovalDialog({ dialogRef, cancelRef, document, state, onCancel, onConfirm, open = false }) {
  const { t } = useTranslation();
  const id = useId();
  return <dialog ref={dialogRef} open={open || undefined} className="load-document-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}
    onCancel={event => { if (state.busy) event.preventDefault(); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <form onSubmit={onConfirm} aria-busy={state.busy}>
      <span className="load-document-confirm-icon"><Trash2 size={21} aria-hidden="true" /></span>
      <h3 id={`${id}-title`}>{t('documentManagement.removeTitle', { document: document.title })}</h3>
      <p id={`${id}-hint`}>{t('documentManagement.removeHint')}</p>
      {document.fileName ? <p className="load-document-confirm-file">{document.fileName}</p> : null}
      {state.error ? <p role="alert" className="load-document-error">{t(`documentManagement.${state.error}`)}</p> : null}
      <div className="load-document-confirm-actions">
        <button ref={cancelRef} type="button" disabled={state.busy} onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="is-danger" disabled={state.busy}>{state.busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}{t(state.busy ? 'documentManagement.removing' : 'documentManagement.remove')}</button>
      </div>
    </form>
  </dialog>;
}
