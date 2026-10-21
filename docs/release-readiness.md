# DriverWeb release checks

Use an official Node build with TypeScript stripping (Node 22.18+ or 24+).
Some distribution Node builds disable this feature; `node -p process.features.typescript`
must return `strip` or `transform`. Run `npm ci`, `npm test`, `npm run lint`,
`npm run i18n:check`, `npm run build`, `npx playwright install chromium`,
`npm run test:ui`, and the isolated database suites in the Quality workflow.
The UI fixture uses synthetic data, disables environment files and stubs operations.
It is outside the production build entry. UI coverage is a smoke gate, not WCAG certification.

## Database release gate

Never edit or replay historical migrations to repair a live ledger. Before any
production database push, export `version` from `supabase_migrations.schema_migrations`
using a read-only query against the verified target project. Save a local JSON object:

```json
{
  "projectRef": "gsnbjpqwwpvqtmphsyfs",
  "capturedAt": "<actual UTC export timestamp>",
  "appliedVersions": ["<each exact applied version>"],
  "approvedPendingVersions": ["<each reviewed forward version>"]
}
```

Run `node scripts/verify-migration-ledger.mjs` then
`node scripts/check-release-plan.mjs /secure/path/ledger-export.json`.
The second command fails on stale/wrong-target evidence, an unexpected pending
migration, or the historical operational reset even when explicitly listed as approved.
This is an operator release guard; it cannot authenticate an export or replace a live
dry-run. Record the remote dry-run, verified backup and successful restore rehearsal
before executing any DB deployment. A missing backup or unexpected reset blocks release.
Do not attach ledger exports or database data to public CI artifacts.

## Headers

Vercel config enforces anti-framing, no-referrer, nosniff, object and base restrictions.
Camera/microphone/geolocation remain available only to this origin for existing features.
A strict resource CSP is **report-only** until authenticated maps, Firebase push/calls,
PDFs, Cloudinary video and privacy/support pages pass staging checks. Inline React/Mapbox
styles currently produce reports; no `unsafe-inline` or `unsafe-eval` exemption was added.
Reports currently appear in the browser console; no third-party report collector receives
URLs. Refine exact origins and nonces/hashes in staging, then promote the resource policy
to enforcement. Do not claim the report-only resource policy blocks XSS today.

## Privacy rollout

Apply the Gmail business policy documented in `security-business-mail.md` before worker
rollout. Review pre-existing mailbox imports with the owner separately; new ingestion
controls do not remove prior data. Deploy media code and test an expired signed URL,
offboarded account access and an open player over the renewal window. Previously issued
permanent Cloudinary URLs require a separate vendor invalidation/migration plan.

Finally verify the deployed commit SHA, headers and real role-based smoke journeys.
Local successful checks alone do not attest deployed behavior or backup readiness.

Implementation references: [Playwright web server](https://playwright.dev/docs/test-webserver), [CSP frame ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
