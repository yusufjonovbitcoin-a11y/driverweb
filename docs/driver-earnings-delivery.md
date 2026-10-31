# Driver earnings delivery

The confirmed settlement PDF dialog includes **Send to driver** for company administrators. The recipient is the original driver identity; editing the printed name never changes the recipient. Demo statements display a disabled delivery button.

The exact generated PDF bytes are uploaded to the private `driver-earnings` bucket. `publish_driver_earnings` verifies the active company administrator, the driver's company, and the completed PDF upload before adding an immutable `driver_earnings` row and audit event. An upload failure does not publish a statement. Retrying an ambiguous response uses the same delivery UUID and checksum; it does not create another statement. Approved PDFs have stable creation/modification timestamps so reopening generates identical bytes.

The companion Flutter app has **Settings → Earnings** (`/earnings`). It lists only the signed-in driver's received statements, preserves cents, and opens the existing PDF viewer using a fresh five-minute signed URL. Pull to refresh and the refresh button re-read deliveries. No signed URLs or earnings documents are written into shared preferences. This is statement delivery, not confirmation of a payment. There is no chat message, email or push notification side effect.

The migrations `20261024013839_driver_earnings_delivery.sql` and `20261024014958_earnings_recipient_isolation.sql` were applied to `driver-platform-core` on 2026-10-24. Only the company administrator and the addressed driver can read the statements and files; dispatchers cannot access these private earnings records. No statement was sent to a real driver during verification. Existing locally confirmed calculations remain scoped to the accounting page session; sent PDFs and their receipt metadata persist in the backend.

Verification:

- `node scripts/test-earnings-db.mjs`: disposable PostgreSQL RLS, recipient/company isolation, immutable amounts, unpublished PDF denial and idempotency.
- `node --test src/services/driverEarningsDelivery.test.js src/components/settlements/*.test.js`
- `npx playwright test --config playwright.settlements.config.js`: preview edits, downloaded amounts, failed delivery/retry, acknowledgement and disabled demo delivery, desktop/mobile.
- Companion app: `flutter test test/widget/earnings_screen_test.dart test/widget/settings_screen_test.dart` and focused `flutter analyze`.

Installing an updated app build is required for the new Earnings page. Source changes do not update an already-installed Android or iOS app.
