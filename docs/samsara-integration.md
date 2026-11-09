# Samsara integration

Company administrators connect under **Profile → Integrations → Samsara**. Each
company has its own consent and token pair. The client secret alone does not grant
access to a fleet; an administrator must approve the Samsara consent screen.

- Callback: `https://gsnbjpqwwpvqtmphsyfs.supabase.co/functions/v1/samsara-oauth-callback`
- Direct install: `https://managefleets.com/#profile?section=integrations`
- US API: `https://api.samsara.com`
- Required read scopes: Read Drivers; Read Vehicles; Read Vehicle Statistics;
  Read ELD Compliance Settings (US) for HOS. HOS also requires an eligible Samsara
  subscription. Missing feed permissions are shown independently in the card.

The card shows vehicles, GPS coordinates/location with the original GPS time,
drivers, their current HOS vehicle, driving time remaining and shift time
remaining. Driver–vehicle associations use Samsara IDs from HOS, not names.
These records are separate from T Fleets assignments, phone presence and pay.
There is no automatic reassignment of existing T Fleets drivers or trucks.

## Server configuration

Four named secrets live in Supabase Vault: `samsara_client_id`,
`samsara_client_secret`, `samsara_encryption_key` (32 random bytes, base64), and
`samsara_worker_token` (random worker credential). Only service_role can call
`get_samsara_server_config`; browser roles cannot read the Vault wrapper or tables.
Do not put these values in VITE variables, committed SQL or logs. Changing the
encryption key requires migrating existing ciphertext or reconnecting accounts.

The three Edge Functions have gateway JWT verification disabled and perform their
own authorization: getUser + active company-admin profile + MFA for management;
single-use hashed, expiring state for callback; dedicated worker token for Cron.
Return origins are explicitly allowlisted; only the integrations route is used.
Tokens are AES-GCM encrypted with the company ID as associated data. Status
responses contain only normalized fleet data and error codes.

`samsara-fleet-sync` runs every two minutes. It sends no HTTP request when no active
company is due. Each invocation selects up to two companies, processes both at a
time, paginates provider reads, and applies a four-minute database lease. Refresh
tokens rotate and are saved before other requests. Ambiguous refresh failures
require re-consent rather than repeatedly replaying a consumed token. Provider
rate limits and ordinary feed outages are retried by Cron. The current per-feed
limit is 30 pages/65 seconds; larger fleets need an incremental cursor worker.

Sync snapshots are atomic. Failed feeds are labeled; old GPS is not presented as
a successful new reading. A generation check prevents old work from writing over
reconnected/disconnected credentials. Disconnect revokes at Samsara and clears
local tokens, state and snapshots. If revocation is unavailable, the UI explicitly
asks the administrator to remove T Fleets in Samsara Apps as well.

## Verification

```sh
npx deno test --no-lock supabase/functions/_shared/samsara-core_test.ts
npx deno check --no-lock supabase/functions/samsara-integration/index.ts supabase/functions/samsara-oauth-callback/index.ts supabase/functions/samsara-sync/index.ts
npx playwright test tests/ui/samsara.spec.js
npm run i18n:check
npm run build
```

Run `scripts/samsara-db-check.sql` after migration (it rolls back every fixture
write and requires an unconnected company). Verify anonymous requests return 401,
callback replay/invalid state redirects without any code/token in the URL, and
the worker accepts only its dedicated secret. A live fleet test additionally
requires the owner's OAuth approval; mocks are not proof of that approval.

Official protocol: https://developers.samsara.com/docs/oauth-20
HOS scope/schema: https://developers.samsara.com/reference/gethosclocks
GPS snapshot: https://developers.samsara.com/reference/getvehiclestats
