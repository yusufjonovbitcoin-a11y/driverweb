# Durable document review worker

`bind_document_version_media` already commits the document, queued check and
`document.ai_check` job together. The mobile call remains a best-effort latency
optimization; it is not the durability mechanism.

`check-load-document` consumes **one** eligible job per scheduled request. Both
scheduled and user requests acquire `claim_document_check` and record the result
with `finish_document_check`. Jobs retry with exponential backoff (60 seconds to
one hour), recover leases older than two minutes, and stop at `max_attempts`.
Late attempts cannot overwrite a newer lease. Receipts, replaced versions,
trashed/deleted loads and already-reviewed checks do not start a paid AI call.
An attempt has a 45-second download/provider budget, shorter than the existing
55-second synchronous Cron transport and the two-minute database lease.

## Deployment gate — not executed by the local fix

1. Apply `20261007003559_atomic_document_import_draft.sql`,
   `20261007003612_durable_document_check_worker.sql` and
   `20261007003622_private_document_check_projection.sql` with the normal migrations.
   Deploy `parse-load-document`, `ask-load-ai` and `check-load-document` together
   with their shared dependencies. The checked-in config intentionally sets
   `check-load-document.verify_jwt=false`: the handler verifies either the user
   session **and document RLS**, or the separate worker credential.
2. Generate a dedicated cryptographically random 32-byte lowercase hexadecimal
   credential. Provision the same value as Edge secret
   `DOCUMENT_CHECK_WORKER_TOKEN` and Vault secret `document_check_cron_token`.
   Use the platform secret UI or a protected stdin-based provisioning process;
   do not put its value in SQL files, shell arguments, source control or logs.
   Reuse the existing validated `chat_cron_project_url` Vault entry.
3. Verify invalid/missing worker credentials return 401, a normal user still
   cannot review an inaccessible document, and an idle queue reports
   `{"claimed":0,"completed":0}`. A non-idle authenticated worker invocation may
   incur an AI charge: it is not a free smoke test.
4. Only after deployment and separate operational approval, create an enabled
   minute schedule under the privileged database operator:

   ```sql
   select cron.schedule('document-check-worker', '* * * * *',
     $$select worker_cron.invoke('document');$$);
   ```

   Inspect an existing schedule before creating one; do not create duplicates.
   The migration only extends the existing credential-safe synchronous helper;
   it does not provision credentials or create/enable any schedule.

Monitor `worker_cron.last_invocations` for the `document` worker (HTTP status and
numeric counts only), and `jobs` for failed/dead-letter `document.ai_check` rows.
Do not broadly reset dead-letter jobs: inspect the cause and explicitly retry
only the affected job after correction. Document upload success remains based
on committed media binding, not AI availability.

Fresh and cached non-RateCon responses use the same operational projection:
financial discrepancies, free-form summaries and unknown fields are omitted;
authorized Rate Con financial reviews remain intact. Cache projection is
read-only and does not rewrite old rows. Private-price drivers (manual hide-rate
or immutable mileage-pay assignment) cannot SELECT raw `document_checks` rows.
The existing security-invoker overview returns status/confidence/time but no
result/model blob for them, and their cached API response reads that same
caller-authorized projection. Hidden Rate Con/receipt rows remain inaccessible;
authorized staff retain their complete historical results. No production check
contents were inspected or rewritten; synthetic historic JSON verifies these
access boundaries without claiming an observed production disclosure.

Future current-check status transitions touch only the safe parent document
timestamp, and `documents` is included in Realtime so existing mobile listeners
refresh without exposing raw review JSON. A locked/trashing parent is skipped
to avoid inverse-lock deadlocks; the client's existing reconnect/refetch is the
fallback. Tests verify the timestamp and publication membership; actual cloud
Realtime delivery remains a deployment smoke-test requirement.

Stop-bound BOL/POD reviews compare their associated pickup/delivery stop. A
counterpart role is compared only when unique; a multi-stop route is never
silently reduced to its first endpoint. Historical warnings are not recomputed.

## Offline verification

```sh
node --test scripts/document-check-worker.test.mjs scripts/load-ai-context.test.mjs scripts/parse-load-single-pass.test.mjs
BACKEND_AUDIT_TEST=1 PG_BIN=/path/to/postgres/bin node scripts/test-load-trash-db.mjs
DOCUMENT_PRIVACY_TEST=1 BACKEND_AUDIT_TEST=1 SECURITY_AUDIT_TEST=1 DRIVER_PAY_TEST=1 PG_BIN=/path/to/postgres/bin node scripts/test-load-trash-db.mjs
PG_BIN=/path/to/postgres/bin node scripts/test-worker-cron-http-db.mjs
```

The Edge handler tests use fake Supabase/storage/OpenAI providers. PostgreSQL
tests use temporary private Unix-socket clusters and mocked HTTP/Vault for Cron;
they never read application credentials or contact a cloud database.
