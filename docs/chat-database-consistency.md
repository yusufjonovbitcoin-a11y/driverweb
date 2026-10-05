# Chat database consistency and privacy

Migration: `20261004234608_chat_consistency_and_privacy.sql`.

This is an additive API/security update. Applying it does **not** bulk-delete or
redact historical messages, notifications, or files. Irreversible redaction and
queued attachment deletion happen only when a sender explicitly invokes
`delete_chat_message` for a currently active message.

## Deployment order

1. Run `npm run test:chat-db`. It creates and destroys its own synthetic local
   PostgreSQL cluster; it does not read an application database URL or credentials.
2. Review/apply the migration to the intended project only with deployment approval.
3. Deploy the media cleanup worker with the new chat job payload support and the
   push worker that rechecks fresh notification/message state before delivery.
4. Deploy the clients that merge message revisions, use private Storage uploads,
   refresh manual unread state, and recover incoming calls after reconnect.
5. Verify the existing authorized cleanup/push scheduler is actually running.
   Durable queue insertion alone is not proof of provider deletion or push delivery.
6. Run read-only deployed schema/privilege checks and Supabase advisors. The local
   fixture is not a substitute for a deployed Storage/Realtime/FCM end-to-end check.

There is no destructive down migration: reversing a schema deployment cannot
recover a message the sender subsequently deleted. Restore from an authorized
backup workflow if content recovery is required.

## Contracts

- Message `revision` is a per-row positive bigint. Existing rows start at 1;
  inserts start at 1 and every update increments it. Sync RPC composite rows
  include it automatically. It is not a global pagination cursor.
- `mark_chat_unread(target_conversation_id)` keeps its old UUID result but stores
  a private reminder. It never reverses shared historical `read_at` receipts.
- `clear_chat_unread(target_conversation_id)` returns a boolean. Use on explicit
  reopening even when every displayed incoming message was previously read.
- `mark_chat_messages_read` still accepts at most 100 visible message IDs and also
  clears the actor's reminder when a valid incoming message is in that batch.
- `mark_chat_read(target_conversation_id)` remains available to old clients.
  `get_unread_chat_count` and `get_chat_unread_summary` agree, including reminders.
- `chat_read_preferences` is published to Realtime and only readable by its owner
  while they retain active conversation access. Client direct writes are denied.
  Clearing updates `marked_unread_at` to NULL instead of deleting a row, since
  Realtime cannot apply row authorization after a DELETE. A surrogate UUID primary
  key also avoids exposing participant/conversation IDs in cascade-delete events.
- `get_incoming_chat_calls()` recovers stale actor calls and returns up to ten
  current incoming ringing calls. `recover_stale_chat_calls()` is actor-scoped.
  `cleanup_stale_chat_calls(batch_size=100)` is service-role-only (maximum 500).
- Call starts lock both participants in stable order across all conversations.
  A busy participant returns `CHAT_USER_BUSY`. Ringing expires after 90 seconds.
  Accepted calls require both participant heartbeats within 75 seconds. Accepting
  resets both clocks; existing calls receive a fresh migration-time grace period.
- Signal payloads must be JSON objects, at most 8 KiB for ICE or 64 KiB for SDP;
  the limit is 120 signals per sender/call/minute. Expired/ended calls reject them.

## Private media and deletion

New client upload path: `{companyId}/{conversationId}/{clientId}/{safeFilename}`
in the private `chat-media` bucket (50 MiB maximum). Upload without upsert.
Only the uploader may inspect an uncommitted object. The other participant gains
read/sign access once a live message references it. Sending checks actual object
ownership (or the legacy Cloudinary registry uploader), not just the path prefix.
One live attachment reference cannot be reused for a second message. Idempotent
retries return the original row even if its reply or attachment was later deleted.

An explicit sender delete atomically:

- Clears body, storage reference, filename, MIME type, size, duration and reply
  pointer, retaining a higher-revision tombstone for synchronization.
- Redacts the precisely linked notification, marks it read and cancels pending,
  processing and failed push deliveries. A later edit likewise updates linked
  notification preview text so a pending delivery need not contain stale text.
- Enqueues `provider.media_delete` exactly once with `messageId` and provider
  identity. Cloudinary jobs carry registry identity; Supabase jobs carry
  `bucket: "chat-media"` and `storagePath`.
- Denies new signed URLs immediately (registry `deleted_at` for Cloudinary;
  private revoked-key registry plus Storage RLS for Supabase). Revoked keys cannot
  be uploaded again. Cleanup is asynchronous and must run through the worker.

`delete_chat_message` still returns `text`, now NULL on success, so old clients
skip their best-effort direct media removal. Queue insertion failure rolls back
the entire mutation, including the tombstone and signing revocation.

## Explicit limits

- Existing soft-deleted rows are not retroactively redacted. Existing unlinked
  notifications have no message ID, so they are not heuristically matched or
  bulk-redacted; exact linkage starts with this version's sends.
- Legacy shared attachment references are not physically removed while another
  live message references them. Legacy other-owned media is not deleted through
  the sender's message. This protects unrelated data rather than guessing ownership.
- Already delivered device notifications, cached/downloaded files, and previously
  issued signed URLs cannot be recalled by a database transaction. Signed URL
  expiry/provider deletion eventually limits access; do not claim instant recall.
- A push already in an external provider request can race a deletion despite a
  fresh pre-send check. No SQL transaction can retract an accepted FCM delivery.
- The migration does not implement native background incoming-call/CallKit push.
- No new SQL fixture or two-session contention test establishes a supported
  production user count. Capacity requires representative measured workload.

## Focused verification

The isolated suite verifies existing keyset/sync/rate/read limits, revision
increments, private manual unread state, active-account/tenant boundaries,
participant-wide call exclusion in two independent concurrent SQL sessions,
recipient recovery, separate peer heartbeat expiry, signaling bounds, media
ownership hijack denial, uploader/recipient Storage RLS, signing revocation,
idempotent sends/deletes, exact notification redaction, push cancellation,
queue-failure rollback, and preservation of unrelated historical data.

The fixture models the relevant constraints/RLS/functions, not the complete
Supabase service stack. Actual object upload, signed URL issuance, realtime
delivery, scheduled jobs, provider cleanup and device rendering need separate
integration validation.

## Delivery verification — 2026-10-05

The migration was applied to the approved `gsnbjpqwwpvqtmphsyfs` project. Its
local SQL SHA-256 is
`8844ea29270d9319b8b0dce9df74085ed696ecc9dec80c87dbbe0b42803271a3`.
Deployed functions were read back and matched their local bundles:
`cloudinary-media` v21, `process-push-notifications` v14, and
`process-media-deletions` v14. Unauthenticated POST checks returned HTTP 401.
Read-only checks confirmed the private 50 MiB bucket, participant heartbeat and
revision columns, private unread Realtime publication, and service-only global
call cleanup permissions. These are deployment/configuration checks, not an
authenticated file-upload or device-push end-to-end test.

The final local focused runs passed 62 web/media/worker tests and 63 Flutter
chat/session/push tests. The isolated PostgreSQL fixture, including concurrent
call exclusion, also passed. Browser/native boundaries use test doubles; no
production load test or real two-device call test was performed.

Client changes include bounded account-scoped history/drafts, revision-aware
reconnect reconciliation, visible-message read receipts, lazy signed-media
loading, retry-safe text/media outboxes, and logout cleanup. Web media blobs
survive reload in IndexedDB and require explicit retry; native pending media
uses app-private files. Outboxes are bounded to 100 items and 200 MiB of media,
with a 50 MiB per-file maximum. Web persistence is pruned after seven days.
Neither local history nor attachments are end-to-end encrypted by this change.

Remaining release checks and limits:

- Client code is local; this delivery did not publish a frontend production
  build, mobile release, Git commit or push.
- Supabase Cron now has a five-minute media cleanup schedule and a paused
  one-minute push schedule. Push remains paused by user request until Firebase
  service-account credentials are added. See [Cron runbook](chat-cron.md) for
  current verification, permissions, and HTTP outcome monitoring.
- Real browser IndexedDB, Storage/Realtime, mobile filesystem, push taps and
  audio/video calling still need authenticated integration testing.
- Native terminated-app incoming calls/CallKit, full offline cold start, and
  call resumption after page reload are not implemented here.
- The conversation/driver summary list is not server-paginated; the timeline
  and rendered sidebar are bounded/virtualized, but very large fleets still
  require summary pagination and representative load measurement. No maximum
  concurrent-user capacity is asserted.
