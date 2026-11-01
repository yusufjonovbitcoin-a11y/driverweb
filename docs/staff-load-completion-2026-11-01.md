# Finish an assigned trip from the web

Saved-load tabs now show **Finish trip** to active company staff after every
applicable pickup has a saved, stop-bound BOL and every applicable delivery has
a saved, stop-bound POD. This is available from the driver and fleet boards
and the map's saved-load detail view.

The confirmation uses the shared calendar, actual delivery time, an explicit
time zone and an optional note. It works without driver acceptance, START,
arrival or delivery actions. Saving documents alone never completes a trip.

## Atomic server command

Migration `20261031221340_staff_complete_load_with_documents.sql` was applied to
the connected Supabase project; the filename matches its recorded migration
version. `complete_staff_load` checks active staff/tenant access, the current
assignment, the reviewed load version and the exact current document-version
set. Removed, stale, unfinished or another stop's evidence cannot satisfy it.

The command records a private receipt, closes applicable stops and the current
assignment, marks the load completed and records the staff actor in the audit
log in one transaction. Concurrent identical requests return the same receipt;
changed requests, assignments or evidence conflict. A read RPC reconciles an
otherwise matching committed request whose HTTP acknowledgement was lost.

The existing START guards have a narrow terminal-state exception tied to the
private receipt's actor, assignment, applying state and current transaction ID.
Ordinary driver and staff stage updates keep their existing START requirements.
Browser roles cannot write receipts or execute the private guard helper.

No START, GPS location, driver acceptance, mileage job or driver-pay amount is
fabricated. A completed trip without START displays that limitation instead of
promising a future START calculation. Completion is not payment confirmation.
Accounting delivery-date reads include the staff-attested actual delivery for
the current assignment, including a historical delivery entered afterward.

## Verification

- 1,012 unit tests passed; production build, lint and i18n parity passed.
- Five desktop browser scenarios passed: evidence-dependent action visibility,
  unstarted completion, stable-ID retry, duplicate/dismissal prevention, and
  absence of the action for read-only users.
- Shared calendar selection was checked inside the native confirmation dialog.
- Isolated PostgreSQL checks passed with real document and START-pay guards:
  active staff/tenant restrictions, per-stop evidence, stale assignment/proof,
  future delivery rejection, unchanged driver/pay history, accounting dates,
  receipt idempotency, concurrent requests and rollback after a forced final
  write failure.
- Deployed RPC route verified over HTTP: anonymous access returns 401 / 42501.
- Deployed role grants verified; no receipt rows or existing customer trips
  were created/modified by production verification.
- Security-advisor categories match the previous baseline. The private table
  intentionally has RLS without client policies; the two staff-only definer
  RPCs have explicit role/company/request guards and an empty search path.

Run the database regression with `STAFF_COMPLETION_TEST=1`,
`STAFF_DOCUMENT_TEST=1`, `START_PAY_AUDIT_TEST=1`, `PENDING_DRIVER_PAY_TEST=1`,
`AUDIT_FIX_TEST=1`, `BACKEND_AUDIT_TEST=1`, `DRIVER_PAY_TEST=1`,
`SECURITY_AUDIT_TEST=1`, `DOCUMENT_PRIVACY_TEST=1` and
`node scripts/test-load-trash-db.mjs`.

Screenshot of the synthetic browser verification:
`output/staff-load-completion-2026-11-01.jpg` (ignored).
