import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, FileUp, History, LoaderCircle, MoreVertical, Plus, RefreshCw, Replace, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import { DocumentCard } from './LoadDocumentsManager.jsx';
import { documentWorkspaceEntries, documentRegistryEntries, selectedWorkspaceEntry, documentViewerLoad, managedDocumentTypes } from './loadDocumentsModel.js';
import DocumentVersionHistory from './DocumentVersionHistory.jsx';
import './load-document-workspace.css';

const shortType = doc => ({ rateCon: 'Rate Con', shipperBol: 'BOL', receiverPod: 'POD' })[doc.id] || doc.title;
function fileSize(bytes) {
  if (bytes == null) return '—';
  const large = bytes >= 1_000_000;
  return formatNumber(bytes / (large ? 1_000_000 : 1_000), { style: 'unit', unit: large ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 });
}

export default function LoadDocumentWorkspace({ load, documents, context, editable, loading, error, onRefresh, onOpenDocs, onManageDocument, actions, notice }) {
  const { t } = useTranslation();
  const allEntries = documentWorkspaceEntries(documents, context);
  const [extraKey, setExtraKey] = useState(null);
  const entries = documentRegistryEntries(allEntries, editable ? extraKey : null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [historyDocument, setHistoryDocument] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const busyRef = useRef(null);
  const selected = selectedWorkspaceEntry(entries, selectedKey);
  const busy = busyKey != null;
  const onBusyChange = useCallback((key, value) => {
    if (value) busyRef.current = key;
    else if (busyRef.current === key) busyRef.current = null;
    setBusyKey(busyRef.current);
  }, []);
  const label = entry => [entry.marker, entry.stop?.facility_name || entry.stop?.city, entry.stop?.region].filter(Boolean).join(' · ')
    || (entry.legacy ? t('documentManagement.loadLevel') : t(entry.document.id === 'receipt' ? 'documentWorkspace.optional' : 'documentWorkspace.brokerDocument'));
  const select = key => { if (!busyRef.current) setSelectedKey(key); };
  const add = entry => { if (!busyRef.current) { setExtraKey(entry.key); setSelectedKey(entry.key); } };
  const manage = async (entry, reviewedLoad, action) => {
    const row = await onManageDocument(reviewedLoad, action);
    if (row?.id && action.action === 'upload') {
      setExtraKey(null);
      setSelectedKey(['shipperBol', 'receiverPod'].includes(entry.document.id) ? `${entry.document.id}:document:${row.id}` : entry.key);
    }
    return row;
  };
  return <div className="document-workspace document-registry">
    <header className="document-workspace-heading">
      <div className="document-workspace-tools"><span><ShieldCheck size={14} aria-hidden="true" />{t('documentManagement.historyHint')}</span>{typeof actions === 'function' ? actions(busy) : actions}
        <button type="button" disabled={loading || busy} onClick={onRefresh} aria-label={t('documentManagement.refresh')} title={t('documentManagement.refresh')}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} aria-hidden="true" /></button>
      </div>
    </header>
    {notice && <p role="alert" className="load-document-error">{notice}</p>}
    {error && <p role="alert" className="load-document-error">{t(context ? 'documentManagement.refreshError' : 'documentManagement.loadError')}</p>}
    {loading && <p role="status" className="document-workspace-loading"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t('documentManagement.loading')}</p>}
    {!context ? <div className="document-workspace-empty" aria-busy={loading}><FileText size={36} aria-hidden="true" /><p>{t(loading ? 'documentManagement.loading' : 'documentManagement.unavailable')}</p></div>
      : <>
        <div className="document-registry-layout">
          <section className="document-registry-main" aria-label={t('documentWorkspace.loadDocuments')}>
            <div className="document-registry-table-scroll">
              <table className="document-registry-table" aria-label={t('documentWorkspace.loadDocuments')}>
                <colgroup>{[19, 22, 18, 13, 8, 20].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead className="document-registry-accessible-head"><tr>{['type', 'file', 'stop', 'status', 'size', 'actions'].map(key => <th key={key} scope="col">{t(`documentRegistry.${key}`)}</th>)}</tr></thead>
                <tbody>{entries.map(entry => <RegistryRow key={`${load.id}:${entry.key}:${entry.document.versionId || entry.document.url || ''}`}
                  load={load} entry={entry} visible selected={selected?.key === entry.key}
                  disabled={busy} onBusyChange={onBusyChange} onSelect={() => select(entry.key)} label={label(entry)}
                  addTarget={editable && entry.document.available ? allEntries.find(item => item.add && item.document.id === entry.document.id && item.document.stopId === entry.document.stopId) : null}
                  onAdd={add} onOpen={() => { select(entry.key); onOpenDocs(documentViewerLoad(load, entry.document), entry.document.id); }}
                  onHistory={() => setHistoryDocument(entry.document)}
                  onManageDocument={onManageDocument && !loading && !error && !entry.missingStop && managedDocumentTypes[entry.document.id] ? (reviewedLoad, action) => manage(entry, reviewedLoad, action) : null} />)}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </>}
    {context && historyDocument?.documentId && <DocumentVersionHistory key={`${historyDocument.documentId}:${historyDocument.versionId}`} document={historyDocument} onClose={() => setHistoryDocument(null)} />}
  </div>;
}

function DocumentFileIcon({ document }) {
  const pdf = document.mimeType === 'application/pdf' || /\.pdf$/i.test(document.fileName || '');
  return <span className={`document-workspace-file-icon${pdf ? ' is-pdf' : ''}`}><FileText size={22} aria-hidden="true" />{pdf && <small>PDF</small>}</span>;
}

function RegistryRow({ load, entry, onBusyChange, onManageDocument, ...viewProps }) {
  const { t } = useTranslation();
  const [downloadState, setDownloadState] = useState({ busy: false, error: false });
  const controller = useRef(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const busyChanged = useCallback(value => onBusyChange(entry.key, value), [onBusyChange, entry.key]);
  const download = async () => {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    setDownloadState({ busy: true, error: false });
    try {
      const { fetchTripDocument, saveDocumentBlob } = await import('../services/tripDocumentAccess.js');
      const result = await fetchTripDocument(entry.document, { signal: abort.signal });
      abort.signal.throwIfAborted();
      if (alive.current) saveDocumentBlob(result.blob, result.fileName || entry.document.fileName || 'document');
      if (alive.current) setDownloadState({ busy: false, error: false });
    } catch { if (alive.current) setDownloadState({ busy: false, error: true }); }
    finally { clearTimeout(timeout); if (controller.current === abort) controller.current = null; }
  };
  return <DocumentCard load={load} document={entry.document} onManageDocument={onManageDocument} onOpen={viewProps.onOpen}
    onBusyChange={busyChanged} missingStop={entry.missingStop} replaceAllowed={!entry.legacy} embedControls renderView={RegistryRowView}
    viewProps={{ ...viewProps, entry, download, downloadState, downloadLabel: t('documents.download') }} />;
}

function RegistryRowView({ document, entry, state, editable, missingStop, replaceAllowed, onOpen, onChooseFile, onRemove, onRetry, controls,
  visible, selected, disabled, onSelect, onHistory, label, addTarget, onAdd, download, downloadState, downloadLabel }) {
  const { t } = useTranslation();
  const locked = disabled || state.busy;
  const status = state.action === 'remove' ? 'removing' : state.progress === 100 ? 'saving' : 'uploading';
  return <>
    <tr hidden={!visible} className={`document-registry-row${selected ? ' is-selected' : ''}${entry.add ? ' is-add' : ''}`} aria-selected={selected} aria-busy={state.busy} onClick={event => { if (!event.target.closest('button,input,summary,details,dialog') && !locked) onSelect(); }}>
      <td><div className="document-registry-type"><DocumentFileIcon document={document} /><div><strong>{document.id === 'rateCon' ? t('documentWorkspace.brokerDocument') : shortType(document)}</strong><span>{document.id === 'rateCon' ? 'Rate Con' : document.id === 'shipperBol' ? 'Bill of Lading' : document.id === 'receiverPod' ? 'Proof of Delivery' : t('documentWorkspace.optional')}</span></div></div>{controls}</td>
      <td><button type="button" className="document-registry-filename" disabled={locked} onClick={document.available ? onOpen : onSelect}>{document.available ? document.fileName || t('documentManagement.filenameUnavailable') : '—'}</button>{!document.available && <small>{t('documents.notUploaded')}</small>}</td>
      <td><strong>{entry.marker ? `${entry.marker} · ${entry.stop?.facility_name || entry.stop?.city || '—'}` : '—'}</strong><small>{entry.stop ? [entry.stop.city, entry.stop.region].filter(Boolean).join(', ') : entry.legacy ? label : ''}</small></td>
      <td><span className={`document-registry-status${document.available ? ' is-uploaded' : ' is-pending'}`}><i className={`registry-dot is-${document.available ? 'uploaded' : 'pending'}`} aria-hidden="true" />{t(document.available ? 'documents.uploaded' : 'documentRegistry.pending')}</span></td>
      <td className="document-registry-size">{fileSize(document.sizeBytes)}</td>
      <td><div className="document-registry-row-actions">
        {document.available ? <><button type="button" className={`document-registry-open${selected ? ' is-primary' : ''}`} disabled={locked} onClick={onOpen}><ExternalLink size={14} aria-hidden="true" />{t('documentManagement.view')}</button>
          <button type="button" className="document-registry-icon-button" disabled={locked || downloadState.busy} onClick={download} aria-label={downloadLabel} title={downloadLabel}>{downloadState.busy ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}</button>
          {editable && <button type="button" className="document-registry-icon-button" disabled={locked || !replaceAllowed} onClick={onChooseFile} aria-label={t('documentManagement.replaceDocument', { document: document.title })} title={t('documentManagement.replace')}><Replace size={16} /></button>}</>
          : editable && !missingStop ? <button type="button" className="document-registry-upload" disabled={locked} onClick={onChooseFile}><FileUp size={16} aria-hidden="true" />{t('documentManagement.add')}</button> : <span className="document-workspace-view-only">{t(missingStop ? 'documentManagement.stopUnavailable' : 'documentManagement.viewOnly')}</span>}
        <details className="document-registry-menu" onClick={event => event.stopPropagation()}><summary aria-label={t('documentRegistry.moreActions')} aria-disabled={locked} onClick={event => { if (locked) event.preventDefault(); }}><MoreVertical size={18} aria-hidden="true" /></summary><div>
          {document.documentId && <button type="button" disabled={locked} onClick={event => {
            const menu = event.currentTarget.closest('details');
            menu.open = false;
            menu.querySelector('summary')?.focus();
            onHistory();
          }}><History size={15} />{t('documentWorkspace.versionHistory')}</button>}
          {addTarget && editable && <button type="button" disabled={locked} onClick={event => { onAdd(addTarget); event.currentTarget.closest('details').open = false; }}><Plus size={15} />{t('documentRegistry.addAnother')}</button>}
          {document.available && editable && <button type="button" className="is-danger" disabled={locked} onClick={event => { event.currentTarget.closest('details').open = false; onRemove(); }}><Trash2 size={15} />{t('documentManagement.remove')}</button>}
        </div></details>
      </div></td>
    </tr>
    {(state.busy || state.error && state.action !== 'remove' || downloadState.error || editable && !replaceAllowed) && <tr hidden={!visible} className="document-registry-feedback"><td colSpan={6}>
      {state.busy && <div className="document-workspace-progress" role="status"><LoaderCircle size={14} className="animate-spin" /><span>{t(`documentManagement.${status}`)} {state.progress == null ? '' : `${Math.round(state.progress)}%`}</span><progress max="100" value={state.progress ?? undefined} aria-label={t(`documentManagement.${status}`)} /></div>}
      {state.error && state.action !== 'remove' && <div className="load-document-error" role="alert">{t(`documentManagement.${state.error}`)}{onRetry && <button type="button" onClick={onRetry} disabled={locked}>{t('documentManagement.retry')}</button>}</div>}
      {downloadState.error && <p role="alert" className="load-document-error">{t('documents.downloadFailed')}</p>}
      {editable && !replaceAllowed && <p className="document-workspace-help">{t('documentManagement.legacyReplaceHint')}</p>}
    </td></tr>}
  </>;
}
