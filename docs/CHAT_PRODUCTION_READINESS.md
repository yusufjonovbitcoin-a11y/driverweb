# Chat production-readiness evidence

Date: 2026-09-26

## Scope

The dispatcher and driver chat now share the same reliability contract:

- cursor-based history pagination with deterministic `(created_at, id)` ordering;
- realtime subscription before the initial fetch, deduplication, update handling, and web reconnect reconciliation;
- foreground reconciliation in the Flutter client;
- immediate rendering of RPC responses so delivery does not depend on realtime echo;
- upload progress, 50 MB validation, retry/cancel on web, and Cloudinary content-type plus magic-byte checks;
- expiring Cloudinary token delivery when `CLOUDINARY_AUTH_TOKEN_KEY` is configured;
- recoverable WebRTC call leases, stale-call cleanup, heartbeat, connection timeout, and ephemeral TURN credentials;
- responsive driver information drawer and lazy-loaded web chat bundle.

## TDD evidence

The first test runs failed because `chatReliability.js`, `chat_sync.dart`, and
`rtc_configuration.dart` did not exist. The production helpers were then added
and integrated into both clients.

| Target | Command | Result |
| --- | --- | --- |
| Web reliability helpers | `node --experimental-test-coverage --test src/**/*.test.js` | 5 passed; 93.88% lines, 90% functions |
| Flutter reliability helpers | `flutter test --coverage test/unit/chat_sync_test.dart` | 5 passed; `chat_sync.dart` 100% lines, `rtc_configuration.dart` 90.9% lines |
| Full Flutter suite | `flutter test` | 36 passed |
| Focused Flutter analysis | `dart analyze lib/features/chat test/unit/chat_sync_test.dart` | no issues |
| Web quality | `npm test && npm run lint && npm run build` | passed; lint has repository-wide warnings and no errors |
| Database recreation | `npx supabase db reset --local` | all migrations applied from zero |
| Database lint | `npx supabase db lint --local --level warning` | no schema errors |
| Database security/workflow tests | `npx supabase test db` | 74 passed |

`flutter analyze` currently crashes inside the Dart analysis server while
decoding the non-ASCII workspace path. The same changed chat files pass direct
`dart analyze`, the full test suite passes, and CI runs analysis from an ASCII
GitHub workspace path.

## Runtime configuration

The deployed `turn-credentials` function requires `CLOUDFLARE_TURN_KEY_ID` and
`CLOUDFLARE_TURN_KEY_API_TOKEN`. It requests one-hour credentials from Cloudflare
Realtime TURN without exposing the long-lived key to clients. Clients retain STUN and
explicit development fallback variables, but reliable calls across restrictive
NATs require those production secrets.

Cloudinary authenticated delivery works with the existing credentials. Strict
time-limited token access activates automatically when a hexadecimal
`CLOUDINARY_AUTH_TOKEN_KEY` is available on a Cloudinary plan that supports
token-based access control.
