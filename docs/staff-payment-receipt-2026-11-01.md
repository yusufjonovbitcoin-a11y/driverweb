# Payment receipt uploads in the load registry

Missing payment receipts now offer the same **Add file** control as other editable load documents. Staff can select a PDF, JPG/JPEG or PNG (up to 50 MiB), see upload progress, open/download the saved file, replace it or remove it while retaining version history. Read-only and trashed-load views keep their existing restrictions.

The client maps `receipt` through the existing versioned staff document manager and acknowledges only the exact document/version/stop returned by the server. Receipt updates refresh the load and viewer projections without changing BOL/POD, prices, route, payment status or trip status.

Migration `20261101085245_staff_payment_receipt_management.sql` extends the existing staff upload/removal RPCs to load-level receipts (`stop_id IS NULL`). It preserves active staff, company, driver scope, media ownership, file metadata, expected-version, retry and audit checks. Legacy staff upload commands cannot bypass these checks. Existing driver receipt commands remain compatible. The migration was applied to the connected Supabase project.

Validation: 1,013 unit tests; four desktop document-registry browser tests including Add → upload → open → replace → remove; isolated PostgreSQL tests for receipt scope, retries, immutable history, stale versions, unchanged load facts, role/tenant restrictions, legacy guards and anonymous denial. Existing multi-stop trip completion and START protections also passed. Lint, production build and `git diff --check` passed. No real customer document was uploaded, replaced or removed during verification.
