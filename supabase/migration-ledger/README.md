# Verified migration history

On 2026-10-07 the linked project `gsnbjpqwwpvqtmphsyfs` ledger was inspected read-only. Eleven local migration names had different timestamps, but each complete SQL body matched its live ledger statement exactly after trimming outer whitespace. Those local files now use the live versions. `2026-10-07.json` records both names and SHA-256 evidence; the offline verifier fails if any canonical SQL or reference drifts.

The unrecorded historical `allow_review_warnings_on_dispatch` function already matched the live effective function body exactly, including its security-definer, volatility, search path and grants. The original SQL is retained unchanged under `history/`. Its idempotent DDL is now a new forward migration, `20261007133312_record_dispatch_review_warning_contract.sql`. It records this contract in the explicitly authorized 2026-10-07 deployment, with one documented correction: parentheses around the right-hand JSON extraction in the warning-array concatenation. A synthetic regression demonstrated that the original operator precedence erased all acknowledged warnings. The manifest stores separate historical and corrected-forward hashes, and the verifier proves that this is the only SQL delta. The earlier `verified_driver_brief` migration still creates the function for fresh installations; no intermediate migration depends on the later warning-specific body.

Run `node scripts/verify-migration-ledger.mjs` from the repository root. This command is offline/read-only. The synthetic PostgreSQL regression runner applies both new forward migrations and tests current behavior.

The manifest above records the initial read-only audit. At that point no production push or deployment had been performed. No production ledger repair or `--include-all` has been used.

## Authorized production deployment: 2026-10-07

The user subsequently requested commit, push and Supabase deployment. A refreshed CLI dry run recognized all historical versions and selected only `20261007130727` and `20261007133312`. Both forward migrations were applied to `gsnbjpqwwpvqtmphsyfs`; the live ledger now has 87 migrations and the final dry run reports `upToDate=true` with no pending migrations. Historical SQL was not reapplied.

The database was deployed before these dependent Edge Functions and clients:

- `ask-load-ai`: version 29
- `calculate-load-route`: version 36
- `lookup-load-contacts`: version 31
- `parse-load-document`: version 61 (shared dependency update)

All four are ACTIVE with JWT verification enabled. Read-only live checks confirmed the capture column and compatible RPC defaults/grants, three lock-free STABLE actor reads, security-invoker overview with zero duplicate load IDs, document immutability guards, strict location freshness and corrected review warnings. No production business data was edited for testing. Existing unknown GPS capture times were deliberately not backfilled.

Security Advisor categories/counts match the pre-deploy baseline; existing RPC grant and password-protection advisories remain. Authenticated production end-to-end testing and a new native app distribution were not part of this deployment.

For future deployments, refresh the migration list and inspect a dry run before applying only pending forward migrations. Stop on unexpected history drift. Schema changes must precede Edge Functions and clients that depend on them.
