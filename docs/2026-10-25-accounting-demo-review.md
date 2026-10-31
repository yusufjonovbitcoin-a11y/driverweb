# Accounting demo and calculation review — 2026-10-25

**Subsequent user request:** the accounting demo was fully removed after this review. Its toggle, sample API, local store, dialogs, text and styling are retired. Accounting now opens only the live workspace, and removes the dedicated legacy demo IndexedDB database. Calculation/PDF samples remain under `tests/fixtures/` for regression checks and are not imported by production code. The findings below describe the earlier implementation and arithmetic verification.

## Result

The accounting demo now uses the same selection, settings, PDF review and confirmation components as the live workspace. Synthetic data is stored in a separate IndexedDB database, scoped to the signed-in user. It survives leaving the demo, route changes and browser reloads. Live accounting continues to use the authenticated Supabase API.

## Issues repaired

- Demo confirmation previously skipped its API and kept approved entries only in component state. Returning to the demo recreated history from current settings, losing user approvals and potentially changing historical figures. Seeding now happens once in the demo store; saved statements retain immutable snapshots and settings versions.
- Approved demo PDFs were regenerated on reopening. Newly confirmed PDFs now retain the exact original bytes, with size and SHA-256 verification on read. Browser integration tests compare downloaded bytes before confirmation and after a full reload.
- Demo confirmation now rejects overlapping loads, stale settings, foreign driver/load identities and invalid PDFs. Concurrent confirmations and lost-acknowledgement retries keep one immutable record.
- Source load buttons now open a local read-only demo detail dialog.
- Demo PDF delivery now saves a local demo copy and reports completion. It does not call the live earnings delivery API. A restart control restores the synthetic data when requested.
- The charge period is displayed next to the calculation hint; weekly/monthly fees no longer depend on an invisible calendar selection.
- Switching a weekly fixed fee to a percentage inside the PDF editor previously left an invalid weekly percentage configuration. The editor now selects a valid settlement frequency and exposes the percentage calculation base.
- The accounting-settings SQL test harness now uses the shared Windows/Linux-compatible isolated PostgreSQL runner. CI includes these SQL checks and the accounting PDF/demo browser suite.

## Independent arithmetic reconciliation

USD amounts below cover 12–18 October 2026, seven inclusive days. `Other deductions` includes dispatch fees and recurring expenses; company commission is listed separately.

| Driver | Gross | Company commission | Dispatch | Recurring expenses | Net to driver |
|---|---:|---:|---:|---:|---:|
| Alex Morgan | 8,500.00 | 850.00 (10%) | 42.50 (0.5% Gross) | 395.00 | 7,212.50 |
| Daniel Reed | 10,500.00 | 840.00 (8%) | 52.50 (0.5% Gross) | 970.00 | 8,637.50 |
| Sam Wilson | 2,200.00 | 220.00 (10%) | 11.00 (0.5% Gross) | 395.00 | 1,574.00 |
| Total | 21,200.00 | 1,910.00 | 106.00 | 1,760.00 | 17,424.00 |

Alex: 8,500 − 850 − 42.50 − 350 insurance − 45 ELD = **7,212.50**.

Verified edge cases include per-load versus aggregate percentage rounding, after-company percentage bases, fixed fees per load/settlement, weekly prorating and full-started-week policy, monthly calendar-day prorating, leap February, cross-month periods, zero versus unknown amounts/mileage, negative Net rejection at confirmation, duplicate selections, mixed drivers, non-USD currency, driver overrides and PDF-only Net adjustments. No arithmetic defects were found in the configured calculation engine within these tested cases.

For a full 31-day October, Alex's recurring fees are 1,550.00 insurance and 199.29 ELD; Net is 5,858.21. This lower Net is expected monthly prorating, not a rounding error.

## Verification evidence

- Full Node suite: **915 passed**, zero failures.
- Accounting/editable-PDF browser checks: **14 passed** across desktop/mobile (final two added checks rerun separately after correcting test locators).
- Saved-statement persistence/retry browser checks: **4 passed** across desktop/mobile.
- Isolated settings database checks: company/driver saves, inheritance reset, concurrent-version checks, permissions/RLS and trusted delivery date filtering passed.
- Isolated durable settlement database checks: archived PDF/snapshot integrity, stable references, stale data rejection, role/tenant isolation and concurrent duplicate prevention passed.
- Lint, translation-key parity, whitespace checks and production build passed. Existing large-chunk build warnings remain.
- On the running localhost application, a synthetic Alex statement was opened, confirmed at 7,212.50, and displayed as one of three approved demo statements. No real settlement or payment was created.

## Scope

Demo persistence is browser-local synthetic storage, not production accounting storage. Demo delivery is a simulation; live driver notifications were not sent. Real settlement creation, real payment, deployment and production database mutations were not part of this verification.
