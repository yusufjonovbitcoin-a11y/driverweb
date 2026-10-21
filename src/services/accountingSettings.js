import { settlementDraft, normalizeSettlementDraft } from '../components/settlementModel';
import { requireSupabase } from '../lib/supabase';
import { percentageBasisPoints } from '../components/accountingModel';

export async function fetchAccountingSettings() {
  const { data, error } = await requireSupabase().from('company_accounting_settings')
    .select('broker_commission_percent,settlement_defaults,version,updated_at').maybeSingle();
  if (error) throw error;
  return data || { broker_commission_percent: null, settlement_defaults: {}, version: 0, updated_at: null };
}

export async function saveAccountingSettings(percentage, version, defaults = {}) {
  const normalizedDefaults = normalizeSettlementDraft(settlementDraft(defaults));
  if (!normalizedDefaults) throw new Error('ACCOUNTING_INVALID_SETTINGS');
  const basisPoints = percentageBasisPoints(percentage);
  if (basisPoints == null || !Number.isSafeInteger(Number(version)) || Number(version) < 0) throw new Error('ACCOUNTING_INVALID_SETTINGS');
  const { data, error } = await requireSupabase().rpc('update_company_accounting_settings', {
    p_broker_commission_percent: (basisPoints / 100).toFixed(2), p_expected_version: version, p_settlement_defaults: normalizedDefaults,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
