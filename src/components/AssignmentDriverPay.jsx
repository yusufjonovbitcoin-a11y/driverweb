import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber } from '../i18n/format';
import { requireSupabase } from '../lib/supabase';
import { createAssignmentDriverPay, observeAssignmentDriverPay } from '../services/assignmentDriverPay.js';

const statusKeys = { awaiting_start: 'pending', calculating: 'calculating', retry_wait: 'retryWait', failed: 'failed', ready: 'calculated' };
const hintKeys = { awaiting_start: 'pendingHint', calculating: 'calculatingHint', retry_wait: 'retryWaitHint', failed: 'failedHint' };

export default function AssignmentDriverPay({ assignmentId, loadId, driverId }) {
  const reader = useMemo(() => createAssignmentDriverPay({
    scope: { assignmentId, loadId, driverId }, getClient: requireSupabase,
  }), [assignmentId, loadId, driverId]);
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  useEffect(() => {
    void reader.load();
    try { return observeAssignmentDriverPay(reader, requireSupabase(), { assignmentId, loadId, driverId }); }
    catch { return () => reader.dispose(); }
  }, [reader, assignmentId, loadId, driverId]);
  return <AssignmentDriverPayView state={state} onRefresh={reader.load} onRetry={reader.retry} />;
}

export function AssignmentDriverPayView({ state, onRefresh, onRetry }) {
  const { t } = useTranslation();
  const id = useId();
  const { pay, loaded, busy, error } = state;
  if (loaded && !pay && !error) return null;
  const pending = pay && pay.status !== 'ready';
  const failed = pay?.status === 'failed';
  const hintKey = failed && ['DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE', 'DRIVER_PAY_ROUTE_INVALID'].includes(pay.errorCode)
    ? 'routeReviewHint' : hintKeys[pay?.status];
  const unknown = t('driverPay.awaitingDistance');
  const rate = pay ? t('driverPay.perMile', { rate: formatNumber(pay.ratePerMile, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
  }) }) : null;
  const errorId = `${id}-error`;
  return <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`${id}-title`} className="text-sm font-bold text-zinc-900 dark:text-white">{t('driverPay.title')}</h3>
      {pay ? <span role="status" className={`rounded-md px-2 py-1 text-xs font-semibold ${failed ? 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200' : pending ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-200'}`}>{t(`driverPay.${statusKeys[pay.status]}`)}</span> : null}
    </div>
    {!pay && !error ? <p role="status" className="text-sm text-zinc-500">{t('common.loading')}</p> : null}
    {pay ? <>
      {pending ? <p role={failed ? 'alert' : undefined} className="text-sm text-zinc-600 dark:text-zinc-300">{t(`driverPay.${hintKey}`)}</p> : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <PayFact label={t('driverPay.frozenRate')} value={rate} />
        <PayFact label={t('driverPay.totalPay')} value={pending ? unknown : formatCurrency(pay.amount)} />
        <PayFact label={t('driverPay.loadedMiles')} value={pending ? unknown : `${formatNumber(pay.loadedMiles)} mi`} />
        <PayFact label={t('driverPay.deadheadMiles')} value={pending ? unknown : `${formatNumber(pay.deadheadMiles)} mi`} />
      </dl>
    </> : null}
    {error ? <div className="space-y-2">
      <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">{t(error === 'retry' ? 'driverPay.retryError' : 'driverPay.panelLoadError')}</p>
    </div> : null}
    {pending || error ? <div className="flex flex-wrap gap-2">
      {pay?.canRetry ? <button type="button" disabled={busy} onClick={() => void onRetry()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t(busy ? 'common.loading' : 'driverPay.retryCalculation')}</button> : null}
      <button type="button" disabled={busy} onClick={() => void onRefresh()} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">{t(busy ? 'common.loading' : 'common.refresh')}</button>
    </div> : null}
  </section>;
}

function PayFact({ label, value }) {
  return <div className="space-y-1"><dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="break-words font-semibold text-zinc-900 dark:text-white">{value}</dd></div>;
}
