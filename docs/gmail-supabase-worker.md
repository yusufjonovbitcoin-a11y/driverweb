# Gmail IMAP worker on Supabase — deployed paused

The `gmail-sync-worker` Edge Function is an alternative host for the existing
company-scoped Gmail IMAP worker, not a Firebase migration and not a cutover.
Deployment does not fetch email or invoke AI. The existing Mac/GitHub worker
configuration and other app features are unchanged.

Verified deployment: project `gsnbjpqwwpvqtmphsyfs`, function version 3,
migration `20261007214350_gmail_cloud_worker_paused.sql`. Global switch is false;
zero control rows/enabled companies and zero schedules target this function.
Hosted POST with the existing default server secret on `apikey` returned
`200 paused, executed=false`; anonymous/publishable credentials returned 401.
The retrieved legacy service-role key was rejected by the exact runtime-key
check, so use the verified modern-key path for future operator calls.
39 mocked Node tests, 3 offline Deno tests, type checking and isolated PostgreSQL
concurrency/security fixtures passed. Active hosted IMAP/AI remains untested.

## Two independent off switches

- Project secret `GMAIL_CLOUD_WORKER_ENABLED=false`. Missing or any value other
  than exactly `true` also means paused.
- `public.gmail_cloud_worker_controls.enabled` defaults to `false`. No control
  rows are seeded by the migration. Missing rows mean paused.
- No Cron job, GitHub workflow or browser timer calls this new function.
- Gateway JWT verification is on. The handler additionally requires the exact
  runtime service-role key or the runtime `SUPABASE_SECRET_KEYS.default` value
  on `apikey`; signed user/anon JWTs and publishable keys are not sufficient.
- Only service-role callers can access the control table and lease RPCs. Never
  put service-role keys, Gmail passwords or worker tokens in a browser/mobile app.

POST accepts only `companyId` (UUID) and `action` (`status` or `run`). With the
global switch off, both actions return HTTP 200 with:

```json
{"status":"paused","reason":"deployment_disabled","executed":false}
```

This response occurs before DB-client creation, runtime import, credentials,
IMAP or provider requests. There is no HTTP `enable` endpoint.

## Runtime safeguards

Company lease, connection ID, configuration version and mailbox UIDVALIDITY
fence each run. Different cloud invocations cannot own the same company lease.
Disabling a company's control invalidates the lease. A checkpoint cannot move
backwards or be committed by an expired owner.

Each invocation handles at most one new message, one pending AI attachment,
one body backfill and one label job, within a 90-second wall-clock budget.
Messages are size-checked before full fetch (8 MiB raw MIME maximum, including
base64 overhead). MIME attachment count and response bodies are bounded.
Raw originals use the existing private storage/signing path. New attachments
are checked for existing checksums before upload. Cursor advancement follows
durable capture, not AI completion.

Oversize/unreadable emails and unverified mailbox generations fail closed:
they remain in Gmail and their cursor is not silently skipped. They require
operator attention. A provider upload that finishes just before a connection
failure can still leave an orphaned asset; this is not exactly-once storage.
Aborting an HTTP call to the existing AI endpoint does not guarantee the remote
AI operation stops. A bounded selector and 30-minute retry cooldown reduce
duplicate attempts, but future activation must include provider monitoring.

## Before any future activation (requires a new approval)

1. Stop and verify the existing Mac LaunchAgent and GitHub worker schedules for
   the target company. They do not participate in the new cloud lease; never
   run both hosts concurrently against the same cursor.
2. Verify the active Gmail connection, stored cursor, configuration version and
   actual INBOX UIDVALIDITY. Explicitly seed the matching baseline into the
   company control while leaving `enabled=false`. Even a zero cursor needs an
   operator-approved baseline; no implicit historical backfill is permitted.
3. Confirm server secrets and Vault credentials exist without exposing them.
   The new function reuses the existing `GMAIL_WORKER_TOKEN` and Vault-backed
   `get_gmail_worker_credentials` path. Do not copy passwords into source code.
4. Test a controlled small mailbox in hosted Supabase, then realistic maximum
   MIME/PDF sizes. Local Deno tests do not prove hosted network or CPU behavior.
   Check current Edge Function CPU/memory/wall limits before enabling.
5. Enable only the approved company, then the global switch; perform one
   supervised invocation. Check ingestion, signed originals, body, AI, labels,
   duplicate handling and checkpoints. Only then add an approved server-side
   schedule. Do not add an automatic scheduler simply by deploying this code.

Pause/rollback: set the global switch false, disable the company control and
stop any future scheduler. An external request already in flight may finish;
wait for the bounded run to terminate and verify its lease/cursor before
restarting the old worker. No table, email or attachment needs deleting.

## Offline verification

```sh
node --test scripts/gmail-cloud-handler.test.mjs supabase/functions/gmail-sync-worker/runtime.test.mjs
PG_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/test-gmail-cloud-worker-db.mjs
npm exec --yes --package=deno@2.9.6 -- deno check --config supabase/functions/gmail-sync-worker/deno.json supabase/functions/gmail-sync-worker/index.ts
npm exec --yes --package=deno@2.9.6 -- deno test --cached-only --deny-net --allow-env=NODE_ENV,PINO_LOG_LEVEL,DEBUG,NODE_V8_COVERAGE --allow-sys=hostname --config supabase/functions/gmail-sync-worker/deno.json scripts/gmail-cloud-deno.test.ts
```

The PostgreSQL test runner uses an isolated temporary socket-only cluster and
rolls back fixtures; it does not connect to production. Deno compatibility
tests use synthetic MIME and fake credentials and explicitly deny networking.

Platform reference: https://supabase.com/docs/guides/functions/limits

Server authentication reference:
https://supabase.com/docs/guides/functions/auth-headers
https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
