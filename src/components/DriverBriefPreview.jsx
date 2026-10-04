import React from 'react';
import { useTranslation } from 'react-i18next';
import { briefFieldLabel } from '../services/driverBrief';

export default function DriverBriefPreview({ brief, sourceUrl }) {
  const { t } = useTranslation();
  const original = sourceUrl;
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{t('driverBrief.title')}</h3>
        {original && <a href={original} target="_blank" rel="noreferrer" className="text-sm font-semibold text-teal-700 dark:text-teal-300">{t('driverBrief.original')}</a>}
      </div>
      <p className="text-xs text-zinc-500">{t(brief.aiDirect ? 'driverBrief.aiDirectHint' : 'driverBrief.hint')}</p>
      <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {(brief.fields || []).map(field => (
          <div key={field.key} className="py-2">
            <dt className="text-xs text-zinc-500">{briefFieldLabel(t, field.key)}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium">
              {typeof field.value === 'boolean' ? t(field.value ? 'common.yes' : 'common.no') : String(field.value)}
            </dd>
            {(field.page || field.quote) && <details className="mt-1 text-xs text-zinc-500">
              <summary className="cursor-pointer">{field.page ? t(brief.aiDirect ? 'importDetails.aiPage' : 'driverBrief.source', { page: field.page }) : t('importDetails.aiQuote')}</summary>
              {field.quote && <blockquote className="mt-1 border-l-2 border-teal-200 pl-2 whitespace-pre-wrap">{field.quote}</blockquote>}
            </details>}
          </div>
        ))}
      </dl>
    </section>
  );
}
