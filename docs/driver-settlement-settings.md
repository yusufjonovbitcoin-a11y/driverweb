# Driver settlement settings

Accounting now opens the focused driver settlement workspace in `src/components/settlements`. The previous finance workspace is retained in source but is no longer the accounting route.

## Workflow

1. Save company calculation settings, or select a driver and disable inheritance to save a driver override.
2. Open Driver settlements, select one driver and a weekly, monthly or manual-load period.
3. Select loads, review gross, company commission, other deductions and net driver pay.
4. Review the snapshot and download a Unicode PDF. PDF creation does not post a payment, lock a load, or create an accounting ledger entry.

Only saved settings participate in calculations. No demo rules, fallback percentages or local-storage success states are used. Administrators can write settings; active company dispatchers can read them. Drivers cannot read these payroll rules.

## Calculation rules

- Gross is the sum of known USD load rates. Missing prices and mixed-driver selections block calculation; missing miles remain unknown.
- Company commission is a percentage or fixed charge, per load or per settlement. It cannot exceed the gross of any allocated load.
- Dispatch commission supports gross or the amount after company commission as its base. Per-load percentages round each load to cents; per-settlement percentages round the combined base once.
- Fixed charges can apply per load, once per settlement, weekly or monthly. Weekly proration uses inclusive calendar days divided by seven, or full started weeks. Monthly charges prorate each calendar month's covered days independently.
- One-time deductions apply once to every generated calculation; they are configuration templates, not a paid/consumed advance ledger. Repeated exports do not record financial transactions.
- Week/month load filters use confirmed delivery events belonging to the current assignment, not planned appointment dates. Older loads without a recorded event can be selected manually and carry a preliminary-calculation notice.
- Net = gross - company commission - other deductions. Negative net remains visible for review.
- All monetary calculations retain cents. The supplied PDF example totals USD 7,212.50; rounded integer lines in the source PDF are not used as accounting precision.

## Storage and installation

Required migrations, in order:

1. `supabase/migrations/20261017215323_company_accounting_settings.sql`
2. `supabase/migrations/20261017215332_driver_calculation_settings.sql`
3. `supabase/migrations/20261017215828_settlement_delivery_transaction.sql`

The settings migration stores a versioned `driver_settlement_v1` envelope within existing settlement defaults, preserving older settings. Company scope and driver overrides are separate. Writes use an administrator-only RPC, optimistic version checks, tenant checks, a company row lock and audit events. Concurrent conflicts require reloading the record.

The broad `20261016143657_tms_finance_core.sql` migration is not required by this focused feature.

The UI clearly blocks saving when the required schema is missing. It never claims local changes were saved remotely. The three required migrations were applied to the linked live Supabase project on 2026-10-18 (Asia/Irkutsk). No sample settings or financial transactions were inserted.

## Validation

- `node --test src/components/settlements/*.test.js src/components/settlementModel.test.js src/components/accountingModel.test.js`
- `npx oxlint src/components/settlements src/components/AccountingOverview.jsx`
- `npm run build`
- Local PostgreSQL checks: company/driver save, inheritance reset, optimistic conflict, invalid payloads, tenant isolation, dispatcher read-only, driver denial, audit writes.
- Browser checks against an isolated PostgreSQL test database: save/reload, driver override/inheritance, actual delivery date filtering, selection and USD 7,212.50 statement.
- PDF checks: Unicode names, exact amounts, optional content, multi-page tables with repeated headers, pickup timezone, preliminary disclosures, and rendered US Letter landscape output.

The PDF uses bundled DejaVu Sans; its license is included in `src/assets/fonts/DejaVu-LICENSE.txt`.

## Live-only workspace

The demo entry point, banner and component are removed. Old `accountingDemo` URLs are cleaned automatically. Synthetic calculation fixtures remain exclusively for regression tests and are never selected by the application.

## Reference PDF layout

The preview and download share the same generated PDF, using the supplied landscape statement layout: company and driver header, earnings table, itemized deductions, and green final driver pay. Pickup dates use the origin appointment and its timezone; missing dates are not replaced with delivery dates. Amounts retain cents. Longer load lists continue with repeated table headers. Statements use the current company name and the selected real driver; no reference-company logo is loaded. Unicode names use the bundled font.

Targeted live activation checks include RLS/grants and authenticated browser reads. Settings must be deliberately configured and saved by the company administrator before exporting; no financial defaults are invented.

The delivery-date RPC is VOLATILE because the production actor helper acquires a profile key-share lock; PostgREST STABLE RPC read-only transactions reject that lock. The isolated regression reproduces this failure before applying the transaction fix.
