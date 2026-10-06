# Firebase Web: notifications and Analytics

Project: `t-fleets`. Supply `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_VAPID_KEY`
through ignored `.env.development.local` / `.env.production.local` files locally,
and the existing Vercel project's environment settings for hosted builds.
Never put literal key values in tracked source, examples, or tests.
These client values remain visible in the compiled browser bundle: environment
variables keep them out of Git, not secret from users. Restrict the Firebase key
to the required Firebase APIs and appropriate application origins in Google Cloud.
Do not use this key for Gemini or other billable server APIs. Server service-account
credentials must never use a `VITE_` prefix.
No Firebase Auth, Firestore or Storage migration is involved. Supabase remains the data store.

## Browser notifications

- Profile → Notifications → Enable notifications. The user grants the browser permission.
- Firebase SDK `getToken` is used deliberately: the existing server sends to registration
  tokens. Do not replace these with Firebase Installation IDs without migrating the sender.
- `register_push_device(token, 'web')` associates this browser with the authenticated account.
- The native Push API worker `/firebase-messaging-sw.js` uses a separate `/firebase-push/`
  scope. It does not intercept navigation or cache app assets, and requires no CDN scripts.
- The worker only accepts this project's sender ID, only displays generic text, and never
  opens payload URLs. Clicking opens Chat or Inbox, not a specific conversation yet.
- Visible matching pages rely on existing Realtime UI (no duplicate system notification).
- Logout/disable silences the worker, disables the DB device and unsubscribes the physical
  browser endpoint. An unavailable database does not prevent browser revocation. Tokens are
  refreshed on app start/focus at most hourly, without another permission request.
- Local storage records opt-in per account and the opaque FCM token; it stores no private key.
- Browser/OS support, HTTPS, notification permission and OS notification settings are required.
  On iPhone/iPad use a supported Home Screen web app. Some embedded browsers do not support push.

## Server prerequisite — not configured by this change

Read-only verification on 2026-10-06 found no `FIREBASE_SERVICE_ACCOUNT_JSON` secret in
Supabase project `gsnbjpqwwpvqtmphsyfs`; Cron `drivex-chat-push` exists but is inactive.
The public VAPID key cannot replace this server credential.

1. Obtain a service-account credential for **t-fleets**, with FCM sending permission.
2. Put its JSON in Supabase **Edge Function secrets** under `FIREBASE_SERVICE_ACCOUNT_JSON`.
   Never commit it, put it in VITE variables, or paste it into chat.
3. Verify credentials against the intended Firebase project before enabling the existing
   `drivex-chat-push` Cron. Consider stale queued notifications before resuming the worker.
4. Perform a real two-account delivery test: foreground chat, background tab, closed tab,
   denied permission, logout and account switching. This change does not claim this test passed.

## Analytics

- Lazy Firebase Analytics, measurement ID `G-SHX06FX3BV`; page-view events use only an allowlisted
  page name. No explicit user ID, chat text, email, phone, load ID, address, search or document
  content is included. Referrer and URL queries are excluded from our event parameters.
- Enabled by default only in production builds on `driverweb-nine.vercel.app`. Localhost and
  preview deployments do not send metrics. Update `analyticsPolicy.js` when adding a custom domain.
- Profile → Notifications → Usage analytics disables collection in this browser.
  Do Not Track / Global Privacy Control also disable it. Advertising consent is denied.
- In Google Analytics Web stream settings, **disable Enhanced Measurement** (especially form
  interactions, site search and browser-history page views). It is managed remotely and can
  otherwise add events outside this client's manual page-view implementation.
- Google Analytics still uses its own measurement identifiers and receives normal network
  metadata; this is not a promise of zero personal-data processing. Update the site's privacy
  notice and consent requirements for the regions served before public rollout.

## Verification

Run `node --test src/services/webPushController.test.js src/services/analyticsPolicy.test.js scripts/firebase-worker.test.mjs`,
`npm run build`, and targeted lint. Firebase SDK is pinned. The grpc override fixes advisories in
Firebase's unused Firestore dependency; Firestore/grpc are not imported into the web bundle.
