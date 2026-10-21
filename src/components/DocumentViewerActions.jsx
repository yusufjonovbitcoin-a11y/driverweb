import { useCallback, useEffect, useId, useState } from 'react';
import { FilePlus2, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DocumentCard } from './LoadDocumentsManager.jsx';
import { documentViewerActionChoices, managedDocumentTypes } from './loadDocumentsModel.js';
import { loadStaffDocumentContext } from '../services/staffLoadDocumentService.js';

export default function DocumentViewerActions({ load, document, onManageDocument, onBusyChange, uploadButtonRef, onUploadAvailable }) {
  const { t } = useTranslation();
  const selectId = useId();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const handleBusy = useCallback(value => { setBusy(value); onBusyChange?.(value); }, [onBusyChange]);
  const [result, setResult] = useState(null);
  const [selectedStop, setSelectedStop] = useState('');
  const active = Boolean(onManageDocument && !load.trashedAt && managedDocumentTypes[document.id]);
  const key = JSON.stringify([load.id, document.id, document.documentId, document.versionId, attempt]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    loadStaffDocumentContext(load.id, controller.signal).then(context => {
      if (!disposed) setResult({ key, context });
    }).catch(() => { if (!disposed) setResult({ key, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
  }, [active, key, load.id]);
  if (!active) return <span className="text-xs text-zinc-500">{t('documentManagement.viewOnly')}</span>;
  if (result?.key !== key) return <span role="status" className="flex items-center gap-2 text-xs text-zinc-500"><LoaderCircle size={16} className="animate-spin" />{t('documentManagement.loading')}</span>;
  if (result.error) return <div role="alert" className="text-xs text-red-600"><span>{t('documentManagement.loadError')}</span><button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>{t('documentManagement.retry')}</button></div>;
  const additions = documentViewerActionChoices(document, result.context);
  const selected = document.available ? additions[0] : additions.find(choice => choice.key === selectedStop) || additions[0];
  if (!selected) return <span role="status" className="max-w-72 text-xs text-amber-700">{t(document.available ? 'documentManagement.conflict' : 'documentManagement.stopUnavailable')}</span>;
  return <div className="flex flex-wrap items-center justify-end gap-2">
    {!document.available && additions.length > 1 && <label className="flex max-w-56 flex-col gap-1 text-[10px] text-zinc-500" htmlFor={selectId}>
      {t(document.id === 'shipperBol' ? 'documentManagement.pickupStop' : 'documentManagement.deliveryStop')}
      <select disabled={busy} id={selectId} value={selected.key} onChange={event => setSelectedStop(event.target.value)} className="rounded-md border border-zinc-200 bg-white p-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
        {additions.map(choice => <option key={choice.key} value={choice.key}>{t('documentManagement.stopOption', { number: choice.stop?.sequence,
          place: choice.stop?.facility_name || choice.stop?.address_line || t('common.notProvided') })}</option>)}
      </select>
    </label>}
    <DocumentCard key={`${key}:${selected.key}`} load={load} document={selected.document}
      onManageDocument={onManageDocument} replaceAllowed={!selected.legacy} missingStop={selected.missingStop}
      renderView={ViewerActionButtons} viewProps={{ uploadButtonRef, onUploadAvailable }} onBusyChange={handleBusy} />
  </div>;
}

function ViewerActionButtons({ document, state, editable, replaceAllowed, onChooseFile, onRemove, onRetry, uploadButtonRef, onUploadAvailable }) {
  const { t } = useTranslation();
  const uploadAvailable = editable && !state.busy && (!document.available || replaceAllowed);
  useEffect(() => { onUploadAvailable?.(uploadAvailable); return () => onUploadAvailable?.(false); }, [onUploadAvailable, uploadAvailable]);
  const uploadLabel = t(document.available ? 'documentManagement.replaceDocument' : 'documentManagement.addDocument', { document: document.title });
  const removeLabel = t('documentManagement.removeDocument', { document: document.title });
  const error = state.error && state.action !== 'remove';
  const iconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
  return <div className="flex flex-wrap items-center justify-end gap-2">
    {editable && <button ref={uploadButtonRef} type="button" className={iconClass} disabled={state.busy || (document.available && !replaceAllowed)}
      onClick={onChooseFile} title={uploadLabel} aria-label={uploadLabel}><FilePlus2 size={18} aria-hidden="true" /></button>}
    {editable && document.available && <button type="button" className={`${iconClass} hover:text-red-600`} disabled={state.busy}
      onClick={onRemove} title={removeLabel} aria-label={removeLabel}><Trash2 size={18} aria-hidden="true" /></button>}
    {state.busy && <span role="status" className="flex items-center gap-1 text-xs text-zinc-500"><LoaderCircle size={14} className="animate-spin" />{t(`documentManagement.${state.action === 'remove' ? 'removing' : state.progress === 100 ? 'saving' : 'uploading'}`)}{state.progress != null && state.action === 'upload' ? ` ${Math.round(state.progress)}%` : ''}</span>}
    {error && <span role="alert" className="max-w-64 text-xs text-red-600">{t(`documentManagement.${state.error}`)}{onRetry && <button type="button" className="ml-1 inline-flex items-center gap-1 underline" onClick={() => void onRetry()}><RefreshCw size={12} />{t('documentManagement.retry')}</button>}</span>}
  </div>;
}
