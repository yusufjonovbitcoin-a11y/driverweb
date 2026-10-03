import { useState } from 'react';
import { AlertTriangle, BadgeCheck, FileText, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../i18n/format';
import { warningLabel } from '../i18n/labels';

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
      review: load.documentChecks?.rateCon,
    },
    {
      id: 'shipperBol',
      title: t('documents.shipperBol'),
      url: load.documents?.shipperBol,
      mimeType: load.documentMeta?.shipperBol?.mimeType,
      review: load.documentChecks?.shipperBol,
    },
    {
      id: 'receiverPod',
      title: t('documents.receiverPod'),
      url: load.documents?.receiverPod,
      mimeType: load.documentMeta?.receiverPod?.mimeType,
      review: load.documentChecks?.receiverPod,
    },
    {
      id: 'receipt',
      title: t('documents.paymentReceipt'),
      url: load.documents?.receipt,
      mimeType: load.documentMeta?.receipt?.mimeType,
      review: load.documentChecks?.receipt,
    },
  ].map((document) => ({ ...document, available: Boolean(document.url) }));

  const currentDoc = docs.find((document) => document.id === activeDocTab) || docs[0];
  const handleClose = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs dark:bg-black/80">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-viewer-title"
        className="flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl transition-colors dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
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

        <main className="min-h-0 flex-1 bg-zinc-100/70 p-3 dark:bg-zinc-900/60">
          {currentDoc.available ? (
            currentDoc.mimeType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(currentDoc.url) ? (
              <iframe
                src={currentDoc.url}
                title={currentDoc.title}
                className="h-full w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center overflow-auto rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <img
                  src={currentDoc.url}
                  alt={currentDoc.title}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )
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

function DocumentCheckSummary({ review, t }) {
  if (!review) return null;
  const status = review.check_status;
  const warnings = Array.isArray(review.active_warnings) ? review.active_warnings : [];

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

  if (!warnings.length && status !== 'failed_to_read') return null;
  return (
    <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-2.5 text-red-900 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
      <div className="flex items-center gap-2 text-sm font-black">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{t('documents.issueCount', { count: Math.max(1, warnings.length) })}</span>
      </div>
      {warnings.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-xs font-semibold">
          {warnings.map((warning, index) => (
            <li key={warning.id || `${warning.code}:${index}`}>{warningLabel(t, warning)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
