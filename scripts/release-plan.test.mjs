import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleasePlan } from './check-release-plan.mjs';
const now = Date.parse('2026-10-14T10:00:00Z');
const reset = '202609250008_clear_operational_data_keep_users.sql';
const forward = '20261013205744_rate_con_visibility_keep_receipts.sql';
const plan = { projectRef: 'gsnbjpqwwpvqtmphsyfs', capturedAt: '2026-10-14T09:50:00Z', appliedVersions: ['202609250008'], approvedPendingVersions: ['20261013205744'] };
test('only exact reviewed forward migrations can pass', () => {
 assert.deepEqual(validateReleasePlan(plan, [reset, forward], now), [forward]);
 assert.throws(() => validateReleasePlan({...plan, approvedPendingVersions: []}, [reset, forward], now), /differ/);
});
test('historical reset blocks even if operator approves its version', () => {
 assert.throws(() => validateReleasePlan({...plan, appliedVersions: [], approvedPendingVersions: ['202609250008', '20261013205744']}, [reset, forward], now), /historical operational reset/);
});
test('wrong project or stale/missing ledger fails closed', () => {
 for (const patch of [{projectRef:'other'}, {capturedAt:'2026-10-13T10:00:00Z'}, {capturedAt:null}, {appliedVersions:null}]) assert.throws(() => validateReleasePlan({...plan,...patch}, [reset,forward], now));
});
