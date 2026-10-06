import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '../lib/supabase';
import { createDriverInstructionsEditor } from '../services/driverInstructionsEditor.js';

export default function DriverInstructionsEditor({ loadId }) {
  const { t } = useTranslation();
  const editor = useMemo(() => createDriverInstructionsEditor({ loadId, getClient: requireSupabase }), [loadId]);
  const { draft, busy, error, saved, remoteText, requiresReview, reviewed } =
    useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  useEffect(() => () => editor.dispose(), [editor]);
  const save = event => { event.preventDefault(); void editor.save(); };
  return <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
    <h3 className="font-semibold">{t('driverInstructions.title')}</h3>
    <p className="my-2 text-sm text-zinc-500 dark:text-zinc-400">{t('driverInstructions.hint')}</p>
    {draft === null ? <button type="button" disabled={busy} onClick={() => void editor.load()}>{t(busy ? 'common.loading' : 'driverInstructions.edit')}</button> :
      <form onSubmit={save} className="space-y-3">
        <textarea aria-label={t('driverInstructions.title')} value={draft} maxLength={12000} rows={5} disabled={busy}
          onChange={event => editor.setDraft(event.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-transparent p-3 dark:border-zinc-700" />
        {remoteText !== null && <div className="space-y-2 rounded-lg border border-amber-300 p-3 text-sm">
          <p>{t('driverInstructions.reviewHint')}</p>
          <p className="whitespace-pre-wrap" aria-label={t('driverInstructions.serverText')}>{remoteText || t('common.notProvided')}</p>
          {requiresReview && <label className="flex items-start gap-2">
            <input type="checkbox" disabled={busy} checked={reviewed} onChange={event => editor.setReviewed(event.target.checked)} />
            {t('driverInstructions.reviewed')}
          </label>}
        </div>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || error === 'conflict' || (requiresReview && !reviewed)} className="rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50">{t(busy ? 'common.loading' : 'driverInstructions.save')}</button>
          <button type="button" disabled={busy} onClick={() => void editor.load()} className="rounded-lg border px-4 py-2">{t('common.refresh')}</button>
        </div>
        {saved && <p role="status">{t('driverInstructions.saved')}</p>}
      </form>}
    {error && <p role="alert" className="mt-2 text-red-600 dark:text-red-400">{t(error === 'conflict' ? 'driverInstructions.conflict' : 'driverInstructions.error')}</p>}
  </section>;
}
