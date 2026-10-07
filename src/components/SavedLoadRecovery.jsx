import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localizedError } from '../i18n/errors';

export default function SavedLoadRecovery({ loads, onResume, onOpenDocs, onTrashLoad, initiallyOpen = false }) {
  const { t } = useTranslation();
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState('');
  if (!loads.length || !onResume) return null;
  const trash = async load => {
    if (pendingId) return;
    setPendingId(load.id); setError('');
    try { await onTrashLoad(load); }
    catch (cause) { setError(localizedError(t, cause)); }
    finally { setPendingId(null); }
  };
  return <details open={initiallyOpen} className="saved-load-recovery rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer font-semibold">{t('loadRecovery.title', { count: loads.length })}</summary>
    <p className="my-3 text-sm text-zinc-500">{t('loadRecovery.hint')}</p>
    {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">{loads.map(load => <li key={load.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><strong>{load.loadNumber}</strong><p className="text-sm text-zinc-500">{[load.origin?.city, load.destination?.city].filter(Boolean).join(' → ')}</p></div>
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        {onOpenDocs && <button type="button" disabled={Boolean(pendingId)} onClick={() => onOpenDocs(load)}>{t('loadTrash.documents')}</button>}
        <button type="button" disabled={Boolean(pendingId)} onClick={() => onResume(load)} className="text-blue-600">{t('loadRecovery.resume')}</button>
        {onTrashLoad && <button type="button" disabled={Boolean(pendingId)} onClick={() => void trash(load)} className="text-red-600">{t('loadTrash.title')}</button>}
      </div>
    </li>)}</ul>
  </details>;
}
