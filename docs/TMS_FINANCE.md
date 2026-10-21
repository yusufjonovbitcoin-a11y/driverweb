# TMS finance workspace

Implemented locally on 2026-10-16. Entry: `#accounting` → `src/components/finance/FinanceWorkspace.jsx`.

## Included workflows

- Work queue from existing operational loads, linked current assignments, accepted-price snapshots and POD presence.
- Broker invoices: select delivered/completed loads for one broker, draft reservation, posting, immutable line snapshots, due date and payment status.
- Driver settlements: completed assignments within the selected business-timezone period; immutable assignment mileage pay preferred, otherwise configured gross percentage, flat-per-trip or explicitly allowed loaded-mile fallback.
- One-time additions, reimbursements and deductions: fixed USD or percentage of the selected loads' known gross. The source base/rate and final rounded amount are frozen in the document.
- A company-wide default commission supplies the driver percentage (100% minus the company fee) when no individual pay template exists; assignment-time snapshots preserve the chosen default.
- Driver-specific recurring fixed amounts with start/end dates and a 1–366 day interval. Each due occurrence can belong to only one active statement.
- Vendor expenses with GL categories and payable balances.
- Advances: issuance, reserved draft applications, posted recoveries and remaining balance tracked separately.
- Actual-payment recording: invoice receipts and expense/settlement disbursements, partial payments, overpayment prevention, payment reversals and manual bank-match confirmation.
- Invoice credit/discount/write-off/factoring-fee adjustments to outstanding AR, selectable contra-revenue/expense account and linked reversal.
- Reports: current AR/AP and aging, posted revenue/expense/operating result, cash movement, driver settlement totals, trial balance and source-linked journal.
- CSV export with spreadsheet-formula neutralization; document print layout for browser Save as PDF.
- Russian, Uzbek and English interface text. Desktop tables have horizontal overflow; narrow-screen toolbars and forms stack.

## Exact server accounting

All commands derive the tenant from the authenticated active profile. Only company admins can write; active dispatchers can read. Drivers cannot read the staff finance workspace. Clients have no direct write grants on financial tables.

`private.finance_entry()` checks balanced nonnegative debit/credit entries before inserting an append-only financial entry. Voids add reversals; posted entries are not deleted.

Posting mappings:

| Event                           | Debit                                                     | Credit                     |
| ------------------------------- | --------------------------------------------------------- | -------------------------- |
| Invoice                         | Customer AR (1100)                                        | Freight revenue (4000)     |
| Driver earning / addition       | Driver earnings (5000), or selected reimbursement expense | Driver payable (2100)      |
| Deduction                       | Driver payable (2100)                                     | Chargeback recovery (4100) |
| Advance issued                  | Driver advances (1150)                                    | Cash (1000)                |
| Advance recovered in settlement | Driver payable (2100)                                     | Driver advances (1150)     |
| Vendor expense                  | Selected expense account                                  | Vendor payable (2000)      |
| Broker receipt                  | Cash (1000)                                               | Customer AR (1100)         |
| Driver/vendor payment           | Payable (2100/2000)                                       | Cash (1000)                |
| Invoice credit / factoring fee  | Selected contra-revenue or expense account                | Customer AR (1100)         |

Amounts are server-side Postgres numeric values. Round percentage and per-load pay to cents before summing. Saved assignment pay overrides a subsequently changed profile tariff. New assignments also capture the current finance pay template; assignments without that record (including those created before a pay rule was configured) are explicitly labeled when their current template is frozen at statement creation. `require_assignment_snapshot=true` blocks a mileage settlement when no snapshot exists; `false` permits only the explicitly configured loaded-mile fallback. Empty mileage is never invented; immutable assignment snapshots already include their actual saved distance basis.

Company-row locks serialize financial mutation commands. Posting revalidates and locks the source load/assignment. Unique active claims prevent invoice-load and settlement-assignment duplication. Version checks reject stale edits. Request UUIDs make create/payment retries idempotent and reject changed payloads under the same UUID.

## Data and rollout boundaries

The finance ledger is USD-only. The operational schema does not have a verified multi-currency ledger. Do not claim conversion or sum foreign currencies.

The prior `load_accounting` figures are exposed for review, not imported or added to new GL totals. They are not automatically converted into posted invoices/payments/expenses. Existing analytics retains its original historical/manual source. Reconcile historical opening balances and choose a cutover date before using ledger totals as company-wide historical accounts.

The finance read RPC explicitly refuses more than 10,000 documents instead of silently truncating totals. Server pagination/archival is needed before exceeding this limit.

Negative-net settlements are rejected for correction; they do not create a fabricated payment or automatically become a new loan. Invoice credits currently cover outstanding AR only; refunds/customer credit balances against fully paid invoices require a separate workflow. Cadence uses an explicit day interval, not a calendar-month claim.

This is an operational carrier finance core, not statutory tax payroll, automated IFTA filing, a connected bank transfer/fuel-card service, or a full external ERP replacement. Bank-match is a manual recorded confirmation. Email/driver delivery is not implemented by a decorative button. Printing invokes the browser's PDF/print flow.

## Migration

`supabase/migrations/20261016143657_tms_finance_core.sql`

Creates 11 finance tables and staff read policies, private helpers and validated public command RPCs. Adds an AFTER INSERT assignment trigger to capture future driver pay templates without changing existing assignments. Does not modify old load amounts, dispatch assignments or existing accounting rows. No real payment or statement is created by the migration itself.

**Not applied to the live Supabase project during this implementation.** It introduces new live financial storage and access policies, so it is prepared for explicit deployment approval. Until installed, the app shows existing assigned loads, a setup-required notice and disabled financial write actions; it does not pretend to save.

The isolated test database uses a deliberately reduced fixture schema. It verifies command behavior and RLS but is not a full replay of every existing project migration. After approved live deployment, verify exact RPC availability, role grants/advisors and a real authenticated read before enabling financial use. Do not insert synthetic financial records into the live company without separate authorization.

## Verification

- Build passes (`npm run build`).
- Focused lint passes (`npm run lint -- src/components/finance src/services/finance`).
- 22 Node regression/model tests pass across finance, trip accounting and legacy accounting models.
- Real PostgreSQL 18 fixture tests pass invoice/partial-payment/reversal, percent/mileage/flat pay, frozen snapshots, one-time percentage fees, recurring charges, advance reservation/recovery, factoring-credit handling, replay/CAS and balanced journals.
- Authenticated cross-company RLS, driver denial, dispatcher write denial and direct-table write denial pass.
- Concurrent PostgreSQL sessions pass duplicate-create replay, stale posting CAS, payment replay and concurrent payment/credit balance ceiling.
- Browser connected to isolated PostgreSQL passes create/post invoice, $100 factoring-fee adjustment ($8,500 → $8,400 AR), create/post $123.45 expense, $23.45 partial payment → $100 payable, and report/journal rendering.
- Main local app at port 5182 renders the new workspace and correctly reports the missing live migration.

Run model tests:

```sh
node --test src/services/finance/model.test.js src/services/tripAccounting.test.js src/components/accountingModel.test.js src/components/settlementModel.test.js
```

Run SQL tests against an existing disposable local PostgreSQL socket on port 55439:

```sh
bash tests/finance/run-local.sh
```

The script creates a uniquely named `tms_finance_test_<pid>` database, runs fixture/scenarios/concurrency checks, and drops only that database on exit. It never reads production DB credentials. `tests/finance/ui.config.js` is a local-only browser QA harness with `.env` loading disabled, fixed synthetic actor and the disposable `financecheck` database. It is not part of the production bundle or a public API.
