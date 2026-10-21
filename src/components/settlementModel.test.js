import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementDraft, normalizeSettlementDraft, previewSettlement, settlementValue } from './settlementModel.js';
test('settlement preview uses exact cents and percentage of original gross', () => {
  const defaults = normalizeSettlementDraft(settlementDraft({ insurance_weekly: '350', logbook_weekly: '45', dispatch_percent: '0.5' }));
  assert.deepEqual(previewSettlement('8500', '10', defaults), { gross: 850000, commission: 85000, afterCommission: 765000, deductions: 43750, remainder: 721250 });
});
test('unset rules remain null; enabled blank is invalid and explicit zero remains zero', () => {
  const draft = settlementDraft();
  assert.equal(normalizeSettlementDraft(draft).fuel_weekly, null);
  draft.fuel_weekly.enabled = true;
  assert.equal(normalizeSettlementDraft(draft), null);
  draft.fuel_weekly.value = '0';
  assert.equal(normalizeSettlementDraft(draft).fuel_weekly, '0.00');
});
test('invalid money and percent cannot produce a settlement preview', () => {
  for (const value of ['', '-1', '1.001', 'Infinity', '1e3', '1000000000']) assert.equal(settlementValue('fuel_weekly', value), null);
  assert.equal(settlementValue('dispatch_percent', '100.01'), null);
  assert.equal(settlementValue('dispatch_percent', '100'), 10000);
  assert.equal(previewSettlement('', '10', {}), null);
  assert.equal(previewSettlement('8500', '', {}), null);
  assert.equal(previewSettlement('8500', '10', { fuel_weekly: 'unknown' }), null);
});
