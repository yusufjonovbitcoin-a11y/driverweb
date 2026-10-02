# Chat reliability checks

Changes are additive and preserve the legacy mobile RPCs. New reads/search use SECURITY INVOKER and existing participant RLS. The visible-message receipt RPC is SECURITY DEFINER because clients must not have arbitrary message UPDATE privileges; it checks active conversation access and limits updates to incoming IDs in that conversation (100 IDs maximum).

## Verification

- `npm test`, `npm run lint`, `npm run build`
- `PG_BIN=/path/to/postgres/bin npm run test:chat-db`: creates an isolated disposable cluster, checks RLS, unread aggregation, sync tombstones, history search, visible receipts, 4,000-character limit, 60 messages/minute limit, and idempotent retries. Never reads a production connection string.
- With Vite running, `/scripts/chat-timeline-test.html` renders a 10,000-message synthetic conversation. Check prepend/append, bottom-follow, and that only viewport rows exist in the DOM. This fixture is not a production build entry.
- `scripts/chat-load-test.mjs`: explicit staging-only WebSocket + history/summary concurrency test at 25/50/100/150 clients. Provide distinct staging accounts; never commit the account JSON. It blocks the current production project. It does not measure voice/video bandwidth or message delivery correctness.

## Failure behavior

- Web text retries reuse a user/conversation/body-digest operation ID, including reload within the same tab for up to 24 hours. No message text is stored by this retry registry. A successful send clears the ID so intentionally repeated text remains allowed.
- Media retries reuse the uploaded reference and ID while the selected File remains available. A timeout never deletes an asset that may already belong to a committed message. Abandoned unreferenced uploads need a separate retention/cleanup policy; no automatic destructive cleanup is deployed here.
- Reconnect walks the complete loaded history window, including tombstones, and buffers events arriving during reconciliation. REST history remains available if the WebSocket fails. Hidden chat history/preview subscriptions pause; the incoming-call listener remains active.
- Read receipts require viewport intersection, a focused visible document, and 450ms dwell. Server updates only those IDs. Mark-as-unread pauses automatic receipts in that conversation until it is reopened.
- Search and media counts query the full authorized history, not just downloaded rows. Search uses PostgreSQL `simple` full-text matching (whole words, not arbitrary substrings).

## Limits not replaced by code

Supabase plan quotas still apply. Large-scale capacity and TURN voice/video load require staging measurements. CI/unit tests and a 10,000-row virtual list are not evidence of 10,000 simultaneous users. The existing Cloudinary upload proxy still buffers uploads (50 MiB max); direct signed upload and orphan cleanup should be evaluated separately with storage-retention requirements.
