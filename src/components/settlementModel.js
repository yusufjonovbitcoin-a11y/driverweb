import { moneyCents, percentageBasisPoints, commissionCents } from './accountingModel.js';

export const SETTLEMENT_FIELDS = ['trailer_weekly', 'truck_weekly', 'insurance_weekly', 'logbook_weekly', 'fuel_weekly', 'ifta', 'check', 'zelle', 'dispatch_percent'];
export const MAX_SETTLEMENT_AMOUNT = 999999999.99;
export function settlementDraft(defaults = {}) {
  return Object.fromEntries(SETTLEMENT_FIELDS.map(key => [key, { enabled: defaults?.[key] != null, value: defaults?.[key] == null ? '' : String(defaults[key]) }]));
}
export function settlementValue(key, value) {
  if (!/^(?:\d+)(?:\.\d{0,2})?$/.test(String(value).trim())) return null;
  const cents = key === 'dispatch_percent' ? percentageBasisPoints(value) : moneyCents(value);
  return cents != null && (key === 'dispatch_percent' || cents <= 99999999999) ? cents : null;
}
export function normalizeSettlementDraft(draft) {
  const result = {};
  for (const key of SETTLEMENT_FIELDS) {
    if (!draft[key]?.enabled) { result[key] = null; continue; }
    const value = settlementValue(key, draft[key].value);
    if (value == null) return null;
    result[key] = (value / 100).toFixed(2);
  }
  return result;
}
// Preview only: configured defaults are assumptions, never actual expense records.
export function previewSettlement(grossInput, percentage, defaults) {
  const gross = settlementValue('gross', grossInput);
  const points = percentageBasisPoints(percentage);
  if (gross == null || points == null || !defaults) return null;
  const commission = commissionCents(gross, points);
  let deductions = 0;
  for (const key of SETTLEMENT_FIELDS) {
    if (defaults[key] == null) continue;
    const value = settlementValue(key, defaults[key]);
    if (value == null) return null;
    deductions += key === 'dispatch_percent' ? commissionCents(gross, value) : value;
  }
  return { gross, commission, afterCommission: gross - commission, deductions, remainder: gross - commission - deductions };
}
