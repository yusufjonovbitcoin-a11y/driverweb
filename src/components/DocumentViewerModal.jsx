import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, FileText, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../i18n/format';
import ImageDocumentViewer from './ImageDocumentViewer';
import { resolveTripDocumentSource, fetchTripDocument, saveDocumentBlob } from '../services/tripDocumentAccess.js';
import { openChatAttachment } from '../services/openChatAttachment';

const PdfDocumentViewer = lazy(() => import('./PdfDocumentViewer.jsx'));

export default function DocumentViewerModal({
  isOpen,
  onClose,
  load,
  initialDocumentTab = 'rateCon',
}) {
  const { t } = useTranslation();
  const [activeDocTab, setActiveDocTab] = useState(initialDocumentTab);

  if (!isOpen || !load) return null;

  const docs = [
    {
      id: 'rateCon',
      title: t('documents.brokerRateCon'),
      url: load.documents?.rateCon,
      mimeType: load.documentMeta?.rateCon?.mimeType,
      versionId: load.documentMeta?.rateCon?.current_version_id,
      review: load.documentChecks?.rateCon,
    },
    {
      id: 'shipperBol',
      title: t('documents.shipperBol'),
      url: load.documents?.shipperBol,
      mimeType: load.documentMeta?.shipperBol?.mimeType,
      versionId: load.documentMeta?.shipperBol?.current_version_id,
      review: load.documentChecks?.shipperBol,
    },
    {
      id: 'receiverPod',
      title: t('documents.receiverPod'),
      url: load.documents?.receiverPod,
      mimeType: load.documentMeta?.receiverPod?.mimeType,
      versionId: load.documentMeta?.receiverPod?.current_version_id,
      review: load.documentChecks?.receiverPod,
    },
    {
      id: 'receipt',
      title: t('documents.paymentReceipt'),
      url: load.documents?.receipt,
      mimeType: load.documentMeta?.receipt?.mimeType,
      versionId: load.documentMeta?.receipt?.current_version_id,
      review: load.documentChecks?.receipt,
    },
  ].map((document) => ({ ...document, fileName: load.documentMeta?.[document.id]?.fileName, available: Boolean(document.url || document.versionId) }));

  const currentDoc = docs.find((document) => document.id === activeDocTab) || docs[0];
  const handleClose = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-1 backdrop-blur-xs sm:p-2 dark:bg-black/80">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-viewer-title"
        className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl transition-colors dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div>
            <div className="flex items-center space-x-2.5">
              <h2 id="document-viewer-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {t('documents.title')}
              </h2>
              <span className="rounded bg-zinc-200 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {load.loadNumber}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {load.origin.city || t('common.notProvided')}, {load.origin.state} ➔ {load.destination.city || t('common.notProvided')}, {load.destination.state} • {formatCurrency(load.rate)}
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label={t('common.close')}
            className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {currentDoc.available && <DocumentCheckSummary review={currentDoc.review} t={t} />}

        <main className="min-h-0 flex-1 bg-zinc-100/70 dark:bg-zinc-900/60">
          {currentDoc.available ? (
            <FreshDocumentViewer key={`${load.id}:${currentDoc.id}:${currentDoc.versionId || currentDoc.url}`} document={currentDoc} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-center dark:border-zinc-700 dark:bg-zinc-950">
              <div className="space-y-2.5 p-8 text-zinc-400 dark:text-zinc-500">
                <FileText className="mx-auto h-10 w-10 text-zinc-400 dark:text-zinc-600" />
                <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('documents.notUploaded')}</div>
                <p className="text-xs text-zinc-500">{t('documents.uploadHint')}</p>
              </div>
            </div>
          )}
        </main>

        <nav aria-label={t('documents.title')} className="flex shrink-0 overflow-x-auto border-t border-zinc-200 bg-zinc-50 px-6 dark:border-zinc-800 dark:bg-zinc-900/30">
          {docs.map((document) => {
            const isActive = activeDocTab === document.id;
            return (
              <button
                key={document.id}
                type="button"
                onClick={() => setActiveDocTab(document.id)}
                className={`flex shrink-0 items-center space-x-2 border-t-2 px-3.5 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-zinc-900 font-semibold text-zinc-900 dark:border-zinc-200 dark:text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                }`}
              >
                <span>{document.title}</span>
                {document.available && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
              </button>
            );
          })}
        </nav>
      </section>
    </div>
  );
}

function FreshDocumentViewer({ document: doc }) {
  const { t } = useTranslation();
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState('');
  const automaticRetries = useRef(0);
  const downloadController = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; downloadController.current?.abort(); }; }, []);
  const resolve = useCallback(async () => {
    const result = await resolveTripDocumentSource({ versionId: doc.versionId, url: doc.url, mimeType: doc.mimeType, fileName: doc.fileName });
    if (!alive.current) throw new DOMException('Document closed', 'AbortError');
    return result;
  }, [doc.versionId, doc.url, doc.mimeType, doc.fileName]);
  const reload = useCallback(() => {
    if (!alive.current) return;
    setFailed(false);
    setSource(null);
    setAttempt(value => value + 1);
  }, []);
  const retry = () => { automaticRetries.current = 0; reload(); };
  const recoverSource = useCallback(() => {
    if (!doc.versionId || !alive.current || automaticRetries.current >= 1) return false;
    automaticRetries.current += 1;
    reload();
    return true;
  }, [doc.versionId, reload]);
  useEffect(() => {
    let active = true;
    resolve().then(result => { if (active) setSource(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [resolve, attempt]);
  const openOriginal = async () => {
    try { await openChatAttachment(doc, resolve); }
    catch { if (alive.current) setFailed(true); }
  };
  const download = async () => {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setActionError('');
    try {
      const result = await fetchTripDocument(doc, { resolveSource: resolve, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (alive.current) saveDocumentBlob(result.blob, result.fileName || (result.mimeType === 'application/pdf' ? 'document.pdf' : 'document'));
    } catch (error) {
      if (alive.current && error.name !== 'AbortError') setActionError(t('documents.downloadFailed'));
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
      if (alive.current) setDownloading(false);
    }
  };
  if (failed) return <div role="alert" className="grid h-full place-items-center text-sm text-zinc-600">
    <button type="button" className="rounded border px-4 py-2 font-medium" onClick={retry}>{t('chat.reloadMedia')}</button>
  </div>;
  const loading = <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500"><LoaderCircle className="h-5 w-5 animate-spin" />{t('documents.loadingPdf')}</div>;
  if (!source) return loading;
  return source.mimeType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(source.mediaUrl)
    ? <Suspense fallback={loading}><PdfDocumentViewer key={attempt} url={source.mediaUrl} title={doc.title} onOpenOriginal={openOriginal} onRetrySource={retry} onSourceError={recoverSource} onDownload={download} downloading={downloading} actionError={actionError} /></Suspense>
    : <ImageDocumentViewer key={attempt} url={source.mediaUrl} title={doc.title} onOpenOriginal={openOriginal} onRetrySource={retry} onSourceError={recoverSource} onDownload={download} downloading={downloading} actionError={actionError} />;
}

function DocumentCheckSummary({ review, t }) {
  if (!review) return null;
  const status = review.check_status;

  if (status === 'passed' || status === 'overridden') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-sm font-bold text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
        <BadgeCheck className="h-4 w-4" />
        <span>{t('documents.aiPassed')}</span>
      </div>
    );
  }

  if (status === 'queued' || status === 'checking') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-blue-200 bg-blue-50 px-6 py-2 text-sm font-bold text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>{t('documents.aiChecking')}</span>
      </div>
    );
  }

  return null;
}
