import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { prepareDocumentDrag, setDocumentDragData } from '../services/documentDrag.js';

// Parent keys by load/document/version; prepared bytes cannot cross documents.
export default function DraggableLoadDocument({ document, onOpen }) {
  const { t } = useTranslation();
  const asset = useRef(null);
  const request = useRef(null);
  const dragged = useRef(false);
  const [status, setStatus] = useState('idle');
  const cancel = () => {
    request.current?.abort();
    request.current = null;
  };
  useEffect(() => () => { cancel(); asset.current = null; }, []);

  const prepare = () => {
    if (!document.available || request.current || asset.current) return;
    const controller = new AbortController();
    request.current = controller;
    setStatus('loading');
    const timeout = setTimeout(() => controller.abort(), 60_000);
    void prepareDocumentDrag(document, { signal: controller.signal }).then(result => {
      if (request.current !== controller || controller.signal.aborted) return;
      asset.current = result;
      setStatus('ready');
    }).catch(() => {
      if (request.current === controller) setStatus('error');
    }).finally(() => {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    });
  };
  const beginDrag = event => {
    dragged.current = true;
    if (!asset.current) {
      event.preventDefault();
      prepare();
      return;
    }
    setDocumentDragData(event.dataTransfer, asset.current.file, asset.current.dragUrl);
  };
  const statusKey = !document.available ? 'documents.notUploaded'
    : status === 'loading' ? 'documents.preparingDrag'
      : status === 'ready' ? 'documents.dragReady'
        : status === 'error' ? 'documents.dragFailed' : 'documents.uploaded';
  return <button type="button" disabled={!document.available} draggable={document.available}
    onPointerDown={event => { dragged.current = false; if (event.button === 0 && event.pointerType !== 'touch') prepare(); }}
    onKeyDown={() => { dragged.current = false; }}
    onDragStart={beginDrag}
    onClick={() => {
      if (dragged.current) { dragged.current = false; return; }
      cancel();
      if (!asset.current) setStatus('idle');
      onOpen();
    }}
    title={document.available ? t('documents.dragDocumentHint') : t('documents.notUploaded')}
    className="flex cursor-grab items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/60 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-55 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-teal-600 dark:hover:bg-teal-950/20">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
      {status === 'loading' ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{document.title}</span>
      <span aria-live="polite" className={`mt-0.5 block text-xs font-semibold ${status === 'error' ? 'text-red-600 dark:text-red-400' : document.available ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'}`}>{t(statusKey)}</span>
    </span>
  </button>;
}
