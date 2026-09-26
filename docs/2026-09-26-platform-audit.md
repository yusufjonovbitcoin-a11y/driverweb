# Web and mobile platform audit — 2026-09-26

## Scope and result

Reviewed the separate `driverweb` React application, `driverapp` Flutter application, and shared Supabase functions/migrations. Existing uncommitted work was preserved. This report describes local changes and verification, not a production deployment or a guarantee that every possible defect is eliminated.

## Corrected defects

| Area | Defect and correction |
| --- | --- |
| Web authentication | Late profile requests could restore an earlier account after logout or account switching. Profile resolution now uses generation checks; private workspace state resets by authenticated identity. |
| Mobile authentication | Repositories and screen state could outlive the authenticated account. Identity changes now rebuild scoped providers, clear authentication/router state, and invalidate in-flight operations. |
| Web calls | Audio-only calls lacked a dependable remote audio element. Remote audio playback and user-triggered autoplay recovery are present. A single persistent chat/call owner prevents route changes from destroying calls. Call overlays render outside hidden page containers. |
| Call cancellation | Async camera/microphone/peer setup could finish after cancellation. Web and mobile now reject stale work and release owned media/peer resources. Mobile signal queue generations isolate successive calls. |
| Call timing | Ringing and connected-call timing were conflated. Outgoing ringing allows 60 seconds; duration starts on connection. Native incoming SDP and TURN operations have bounded waits. These changes do not promise instant media on every network. |
| Chat operations | Late history/send/upload/delete responses could affect a different selected conversation. Scope checks prevent stale updates; failed sends preserve newer drafts; repeated roster chat selection works. Hidden voice recording is discarded and releases the microphone. |
| Chat layout and unread counts | Explicit constrained grid sizing keeps the composer visible with long media/history. Read/deleted message updates decrement the mobile badge once; late events cannot undo confirmed reads or subtract newer unread messages. |
| Mobile document state | A slower earlier category request could overwrite the selected category. Request generations and mounted guards prevent stale updates. |
| Manual load creation | The old form could fabricate route, price, contact and document values. Manual fields are now explicit and validated against database constraints; document input uses the actual parsing pipeline. Drivers must be deliberately selected. |
| Profile creation | Unsupported truck/location fields and placeholder business details could appear saved despite not being accepted by the API. The form now sends supported fields and uses honest empty values. |
| Financial analytics | Removed invented growth, on-time, payment-guarantee, broker and fleet figures. Contract amounts, broker totals, equipment load counts and weighted RPM now derive from actual loads. Source availability flags distinguish unknown values from real zero amounts. No contract total is presented as money received. |
| Map addresses | Route queries now include city, region and postal code alongside the street instead of using an ambiguous street-only address. |
| Backend chat access | Added active-profile, tenant and participant enforcement for chat/call operations; reply targets must belong to the conversation; clients cannot spoof system/call messages. |
| Duplicate messages | Retrying a client message ID could generate duplicate notifications. Database insertion is idempotent and rejects cross-conversation reuse. |
| Media deletion | A driver who could read an asset could attempt to delete another uploader's media. Deletion now requires an active same-company uploader or manager and handles persistence failures. |
| Gmail backlog | Processing only the newest batch before advancing the cursor could permanently skip older mail. Bounded processing now follows ascending UID order with checked checkpoints. |
| Native packaging | Added the missing iOS location usage explanation. Android release builds require an explicit release keystore instead of silently using debug signing. |

## Verification

- Web: 33 tests passed, including auth races, chat async scopes, manual load validation, financial aggregation, signal ordering and Gmail backlog regression tests.
- Web lint: zero errors and warnings. Production Vite build succeeded. A bundle-size warning remains for the main chunk (approximately 614 kB before compression).
- Supabase: 96 SQL assertions across six suites passed against the local database, using transactional rollback. Eleven edge-function entrypoints passed `deno check`.
- Media authorization: one Deno test covering eleven permission cases passed.
- Flutter: zero analyzer issues and all 63 tests passed, including the final unread-counter regressions.
- Android: a debug APK with the existing local Supabase configuration builds successfully. No account secrets are included in this report.
- Browser smoke checks: driver roster/detail navigation, repeated driver-to-chat selection, load board, blank manual-load form, Escape dismissal and focus restoration, documents, inbox and finance navigation, and visible chat composer with long media. No test messages, live calls, uploads or operational record creation/deletion were performed. Normal view actions may update read receipts.

Flutter analysis runs in an ASCII temporary checkout because the analyzer server failed on the localized original path. The validated `lib/` and `test/` sources were synchronized from the original working tree; Android compilation runs in the original repository.

## Remaining release checks and limitations

1. These changes have not been deployed to Vercel/Supabase or installed on the phone during this audit. A successful local build is not proof of production behavior.
2. Run a two-device call test after rollout: web to Android, Android to web, voice-only, video, reject/cancel while connecting, reconnect, background/foreground, and separate Wi-Fi/mobile networks. Verify first remote frame, remote audio and release of camera/microphone after hangup. Native RTC behavior cannot be fully proven by unit tests.
3. iOS native compilation and a physical iOS call were not verified on this Linux host. Android release signing requires the project's actual release keystore.
4. Do not replay all historical migrations blindly. `202609250008_clear_operational_data_keep_users.sql` contains intentional historical operational-data truncation. Preserve it, inspect remote migration history, and apply the new chat security migration selectively with the required prior chat schema in place.
5. Cloudinary Free uses authenticated, server-signed delivery URLs. They prevent unsigned access and URL tampering, but an issued URL does not expire; strict time-limited token delivery requires Cloudinary Advanced.
6. Durable application-level rate limiting for TURN/media/AI and Gmail UIDVALIDITY recovery remain separate hardening work.
7. Load creation/approval/routing/offering is a multi-step workflow. Partial server failures need an operational recovery path; this audit does not certify that the entire workflow is transactional across external services.
8. A load/concurrency test, deployment/restore drill and complete device/network matrix were not run. No numerical user-capacity or “9.5/10 production ready” claim is justified by this audit alone.

## Local verification commands

Web: `npm test`, `npm run test:edge`, `npm run lint`, `npm run build`.

Edge functions: `deno check supabase/functions/*/index.ts`.

Mobile: `flutter analyze`, `flutter test --reporter expanded`, and `flutter build apk --debug --no-pub --dart-define-from-file=config/supabase.local.json`.

Both repositories: `git diff --check`.
