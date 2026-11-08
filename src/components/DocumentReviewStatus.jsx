import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function DocumentReviewStatus({ status }) {
  const { t } = useTranslation();
  if (status !== 'loading' && status !== 'error') return null;
  return <span role="status" className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
    {status === 'loading'
      ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
      : <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
    {t(status === 'loading' ? 'documents.reviewsLoading' : 'documents.reviewsUnavailable')}
  </span>;
}
