import { useWorkspaceQuery } from '../hooks/WorkspaceCache';
import FinancialCenter from './analytics/FinancialCenter';
import DriverFinancialReport from './analytics/DriverFinancialReport';
import { fetchFinancialCenter, saveTripAccounting } from '../services/tripAnalyticsService';
const LIVE_API = { read: fetchFinancialCenter, save: saveTripAccounting };

export default function AnalyticsOverview({ drivers = [], scopeDriver, onOpenLoad, onOpenAccountingSettings, canEditAccounting, api = LIVE_API }) {
  const { data, error, isLoading, isValidating, mutate } = useWorkspaceQuery(['financial-center'], () => api.read(), { staleTime: 15_000, refreshInterval: 60_000 });
  const denied = error && (/ACCOUNTING_PERMISSION/.test(error.message || '') || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code));
  async function save(row, amounts, notes) {
    await api.save(row, amounts, notes);
    try { await mutate(); return { refreshFailed: false }; }
    catch { return { refreshFailed: true }; }
  }
  const Report = scopeDriver ? DriverFinancialReport : FinancialCenter;
  return <Report key={scopeDriver?.id || 'company'} scopeDriver={scopeDriver} source={denied ? undefined : data} drivers={drivers} loading={isLoading} refreshing={isValidating} error={error} onRefresh={() => mutate()} onOpenLoad={onOpenLoad} onOpenAccountingSettings={onOpenAccountingSettings} onSaveAccounting={save} canEditAccounting={canEditAccounting && !error} />;
}
