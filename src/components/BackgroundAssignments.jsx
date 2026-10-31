import { AlertCircle, ArrowRight, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './background-assignments.css';

export default function BackgroundAssignments({ tasks, onRetry, onReview, onDismiss, reviewDisabled = false }) {
  const { t } = useTranslation();
  if (!tasks.length) return null;
  return <section className="assignment-tasks" aria-label={t('backgroundAssignment.title')}>
    <ul>{tasks.map(task => <li key={task.key} className={task.status === 'failed' ? 'is-failed' : ''}>
      {task.status === 'failed' ? <AlertCircle size={19} aria-hidden="true" />
        : <LoaderCircle size={19} className="assignment-task-spinner" aria-hidden="true" />}
      <div className="assignment-task-copy">
        <div role="status" aria-atomic="true"><strong>{task.label}</strong><span> → {task.driverName} · {t(`backgroundAssignment.${task.status}`)}</span></div>
        <p>{task.status === 'failed' ? task.error : t('backgroundAssignment.hint')}</p>
      </div>
      {task.status === 'failed' && <div className="assignment-task-actions">
        <button type="button" onClick={() => onRetry(task.key)}><RotateCcw size={15} />{t('backgroundAssignment.retry')}</button>
        <button type="button" disabled={reviewDisabled} onClick={() => onReview(task.key)}>{t('backgroundAssignment.review')}<ArrowRight size={15} /></button>
        <button type="button" className="assignment-task-dismiss" aria-label={t('common.dismiss')} onClick={() => onDismiss(task.key)}><X size={17} /></button>
      </div>}
    </li>)}</ul>
  </section>;
}
