# Assignment acknowledgement latency

The dispatcher action already creates an active, accepted assignment in the SQL
transaction. The web previously waited for a separate Edge preflight before
direct/review assignment, then waited for a full workspace refresh (nine paged
resources and possibly another queued refresh) before closing the review.

The direct and reviewed assignment services now call one atomic RPC. The database
still checks driver access, load state, document checksum and fixed-pay route
eligibility, and freezes the pay rate in the assignment trigger. A missing or
mismatched acknowledgement is rejected. Confirmed rows are merged locally by
UUID; no internal load number or assignment UUID is fabricated.

After acknowledgement, the preview closes and the load appears assigned while
the workspace refresh runs in the background. An older in-flight read is fenced
out. A failed background refresh does not turn a committed assignment into a
failed send. Realtime data already showing a newer stage is preserved. New manual
loads use the same immediate confirmed-row update.

PDF confirmation on Supabase was updated from version 69 to 70 by removing only
the duplicate pay preflight before `review_and_assign_document_load`. The exact
deployed v69 source bundle was used; the other dependencies, preview signature
validation, JWT requirement and extraction behavior were unchanged. The unrelated
local PDF engine changes were not deployed. The rollback source is retained in
the ignored `tmp/assignment-parser-v69-backup.json`.

Verification: 20 targeted service/recovery tests, the isolated PostgreSQL START-pay
audit suite (authorization, rate freezing, pending snapshots and replay), lint,
i18n parity and production build passed. An isolated UI check kept workspace
refresh unresolved and still showed the confirmed assignment after a single
submission. The deployed v70 bundle was read back and checked; OPTIONS returned
200 and an unauthenticated POST returned 401. No real driver's load was changed
for testing.

New PDF confirmation still requires the original file to be durably uploaded and
the assignment transaction to commit. The UI never claims acceptance before that
acknowledgement. No production before/after assignment latency benchmark is claimed;
aggregate parser request timings include AI preview requests and are not an
assignment-only measurement.

## Imported-PDF button follow-up

The user clarified the exact pending button in the PDF review footer. Four real
confirmation logs (AI calls = 0) showed 6,998–11,009 ms for persistence; original
Storage upload accounted for 1,053–1,479 ms. Sequential database API round trips
were the remaining bottleneck, not another AI extraction.

Version 71 now takes a focused fast path for a new signed-PDF confirmation. After
the existing authentication, signed-preview verification and import claim, it
stores the trusted snapshot, prepares the draft/metadata/ordered stops/upload
lease in one database command, uploads original bytes under caller Storage RLS,
and finalizes source/check/job/review state/audit in a service-only command. The
existing caller RPC reviews and assigns atomically. Persistence starts only on
Send; extraction/preview behavior and existing-draft recovery are unchanged.

The migration is `20261031193451_batch_import_assignment_persistence.sql` (the
filename matches the verified remote migration ledger). Original checksum,
tenant/creator restrictions, source lease, immutable version and pay-rate checks
remain enforced. Completion cannot be invoked by a browser. If Storage reports
a conflict, stored bytes are hashed before completion. A missing/mismatched
assignment acknowledgement is never displayed as success.

Verification: 66 targeted Edge/service/regression tests passed, as did isolated
PostgreSQL tests for real preparation/finalization, tenant/creator checks, upload
failure, transaction rollback and atomic assignment. Lint and production build
passed. Remote v71 source/JWT and database grants were read back; OPTIONS=200,
unauthenticated POST=401. The v70 rollback bundle is in ignored
`tmp/assignment-parser-v70-backup.json`. No real driver was assigned for testing;
there is no measured production after-change end-to-end latency claim.

## Non-blocking assignment in the web workspace

Submitting a signed PDF now transfers its File, preview ticket and selected
driver into an app-scoped, account-scoped in-memory queue. The review closes
immediately without the global operation overlay. A persistent status row shows
the load/driver and pending state across route changes; success updates the roster
only after server acknowledgement. It cannot reopen or clear a newer import.

Failed tasks retain the original input for a guarded retry or explicit return to
review. A source checksum deduplicates pending submissions, including attempts to
submit the same source to a different driver. Late results after account changes
are fenced out. A lost HTTP response is reconciled through RLS-scoped reads of
the exact creator/checksum, load's current assignment and selected driver, with
session identity checked before and after. A pending import or unrelated active
assignment cannot be used as a success acknowledgement.

This is a browser-lifetime queue, not a durable server job. File/ticket contents
are never stored in localStorage. Ordinary route navigation is allowed; a native
beforeunload guard warns before refresh/closing while requests are pending. The
tab must remain open. Real driver assignments were not created for testing.

Verification: 76 targeted tests (queue lifecycle, deduplication, error recovery,
account fencing, acknowledgement reconciliation and existing Edge contracts),
lint, i18n parity and build passed. An isolated browser fixture verified immediate
review closure, navigation during an unresolved request, one retry, return to the
same document/driver and completion without navigation. Screenshot:
`output/background-assignment-2026-11-01.png` (synthetic UI verification).
