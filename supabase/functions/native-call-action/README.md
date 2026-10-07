# Native incoming call backend

The server creates a durable delivery row when any supported client starts a call. The database triggers wake the worker after commit using only the call UUID, while a trusted cron drain recovers lost hints. No bearer, APNs, FCM, or capability secret enters `pg_net`.

## Client contract

1. Register normal push through `register_push_device(token, platform)`.
2. Android clients that handle data-only native calls opt in with `register_native_call_device(fcm_token)` (returns its owned device UUID, or null). Older devices retain a normal incoming-call notification. Ordinary chat push is unchanged.
3. iOS registers `register_voip_device(voip_token, environment, bundle_id, fcm_token default null)`. Environment is `sandbox` or `production`; the optional owned iOS FCM token enables deduplicated fallback and one canonical device identity. Unregister VoIP explicitly at logout with `unregister_voip_device(voip_token, environment, bundle_id)`. Removing/disabling/transferring its linked FCM token also invalidates VoIP immediately.
4. Invitations contain string fields `event=incoming_call`, `call_id`, `conversation_id`, `caller_name`, `call_kind`, `recipient_id`, `device_id`, `expires_at`, `action_token`, and `action_url`. Ring expiry is the unchanged `chat_calls.started_at + 90 seconds`.
5. Native cold-start status/decline: POST `{call_id, action_token, action: "status" | "decline"}` to the fixed project `/functions/v1/native-call-action`. Validate the HTTPS project host and exact endpoint locally before sending. The response is `{call_id,status,can_answer,expires_at,accepted_device_id}`. HMAC scope cannot accept a call and is bound to call, recipient, device, and a 120-second absolute lifetime. Every action rechecks current block, tenant, profile, and device state. Status/decline are safe to retry within that lifetime.
6. After authenticating as the recipient, call `claim_native_chat_call(call_id, device_id)` **before acquiring media**. It returns the current chat-call row. The same device may retry; other devices receive `CALL_ANSWERED_ELSEWHERE`. Do not call legacy `respond_chat_call(..., 'accepted')` after claiming. Authenticated legacy clients retain their existing flow.
7. Native recipient hangup/decline uses authenticated `finish_native_chat_call(call_id, device_id, action)` with `action=ended|declined`. Ringing may end/decline; an accepted call only ends for its winning canonical device. A losing device or late decline returns the current row unchanged. Caller outgoing hangup retains the existing authenticated flow.
8. FCM cancellation uses `event=call_ended`, `call_id`, `conversation_id`, `recipient_id`, `device_id`, `expires_at`, `call_status`, and `accepted_device_id`. An accepted call dismisses recipient siblings and excludes its winner. Never terminate the winning call for an accepted event that matches its device. Terminal end/decline/miss dismisses participant mobile devices. Web keeps its existing realtime handling; data cancellation is omitted there because its legacy service worker displays every push. Call invitations include camelCase route aliases for existing web/mobile notification handling. Cancellation never uses a VoIP push; use regular FCM, realtime, status checks, and local ring timeout.

## Server activation

Required existing variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and matching `PUSH_CRON_TOKEN` or `PUSH_WORKER_TOKEN` for the existing Vault `chat_push_cron_token`.

New server-only secrets: random `NATIVE_CALL_ACTION_SECRET` of at least 32 characters; `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (PKCS8 `.p8` PEM), `APNS_BUNDLE_ID` matching the signed app bundle. Store through the approved secret manager; never commit, print, or pass them in client config. Sandbox/production APNs host comes from each verified client registration. APNs sends ES256 authentication, `<bundle>.voip`, priority 10, and expiration 0.

Review/apply migration `20261007155627_native_incoming_call_delivery.sql`, deploy `native-call-action` and `process-native-call-push` with the checked-in `verify_jwt=false` configuration, and configure the secrets. Both endpoints perform their own narrowly scoped authorization: signed capabilities or bounded existing-outbox wakes. An unknown valid wake UUID returns the same 202 response as a real call. The worker reads provider credentials only after claiming real work. APNs misconfiguration falls back to linked ordinary iOS FCM; missing capability configuration preserves ordinary Android notifications.

After deployment verification, activate the durable retry schedule once:

```sql
select cron.schedule('native-call-delivery', '5 seconds',
  $$select worker_cron.invoke('native_calls')$$);
```

Check for an existing job by name before scheduling. The migration prepares the credential-safe synchronous cron transport but deliberately does not activate it. Existing push, media, and document workers remain available. Do not ship native-enabled clients before the migration, endpoints, and secret configuration are verified.

## Validation

- `npm test` includes synthetic HMAC, ES256 APNs, native/legacy FCM payload regressions. Network transports are mocked.
- `PG_BIN="$(pg_config --bindir)" npm run test:native-call-db` creates a private temporary PostgreSQL cluster, loads actual call/safety/registration/worker migrations, and checks native lifecycle, blocks, RLS/grants, account transfer/logout, 90-second expiry, durable worker leases, and a concurrent two-device answer race. HTTP is stubbed; it never reads app credentials or `DATABASE_URL`.
- `deno check supabase/functions/native-call-action/index.ts supabase/functions/process-native-call-push/index.ts` validates both Edge entrypoints.
- Real signed iOS/Android device verification is still required for background/locked/cold-start ringing, accept/decline, logout, sibling cancellation, APNs environment, and operating-system notification permissions. Provider delivery and background execution are controlled by the operating systems; local tests do not establish real push delivery.

## Deployment record — 7 October 2026

Migration `20261007155627` was applied to `gsnbjpqwwpvqtmphsyfs`; both native Edge Functions are active at version 1. APNs server secrets and the dedicated action signing secret are configured. Unknown-call wake returned 202, invalid capability returned 401, and the trusted empty worker returned 200. The `native-call-delivery` five-second retry job is active and completed successfully. Native RLS/grants were checked.

`FIREBASE_SERVICE_ACCOUNT_JSON` for project `t-fleets` is configured. RSA/project checks, Google OAuth through the production helper, and an FCM HTTP v1 `validate_only` request with the native payload all passed (HTTP 200). The request targeted a synthetic topic and delivered no notification. The stored secret digest matched the validated JSON; no credential is committed. The most recent three native cron runs also succeeded.

Ordinary iOS FCM cancellation/fallback additionally requires an APNs authentication key in Firebase Cloud Messaging settings; this console setting has not been inspected. Direct VoIP uses the separate Supabase APNs configuration. No physical-device delivery/audio, signed archive or App Store upload is asserted.
