# Driver passwords

The administrator's driver profile and edit page provide **Driver password**. Opening the dialog checks only whether a saved value is available. The eye button retrieves it explicitly; the value starts masked, is cleared when hidden/closed or the page becomes hidden, and is never put in browser local/session storage. The same dialog sets a new password with confirmation, draft protection, and a 6–128 character driver policy. Staff password rules remain at their existing 12-character minimum.

Only newly set passwords from this administrator action can be saved for later viewing. Older Supabase Auth password hashes cannot be recovered. The UI asks the administrator to set a new password once when no saved copy exists. A driver changing their password elsewhere automatically removes the obsolete copy.

## Backend and access

- Supabase Vault encrypts the copy. A private, RLS-enabled table stores only its Vault UUID, tenant, timestamp and fingerprint of the current Auth password hash. Plaintext is absent from profiles, audit JSON and this link table. Ordinary signed-in/anonymous roles have no table or RPC permission.
- Both Edge endpoints verify the user's JWT, enrolled MFA assurance, active company-administrator role, same-company driver ownership and active/suspended target status. The database repeats actor/tenant checks using fresh, locked profile rows before service-only operations. No user-editable metadata is trusted.
- Reset and reveal are limited to 10 operations per five minutes per administrator. Availability checks have a separate 60/minute limit. Failed authorization, limiter, readiness or audit checks fail closed. Responses use `Cache-Control: no-store, private`; provider/SQL errors are replaced by fixed safe codes.
- Before saving a copy, the database verifies it against the current Auth hash while holding the Auth row. This prevents a concurrent password change from archiving an obsolete value. Read operations also compare fingerprints. Auth password changes, driver company/role/deletion changes and FK cascades clean up the encrypted copy.
- Each server retrieval is audited as `driver.password_viewed` before decryption. A failed audit prevents the reveal. Reset intent and successful encrypted retention are separate events. No password, hash, token or ciphertext enters audit metadata.
- If Auth reset succeeds but retention subsequently fails, the response reports a successful reset with `retained: false`. The dialog explains that the new password changed but could not be retained; it does not misleadingly claim the reset failed.

## Deployment and verification

Applied migration `20261026085439_driver_password_vault.sql`; deployed `read-driver-password` v1 and `update-driver-password` v3 with JWT verification enabled. No real driver's password was changed during development, and no old password was retrieved.

Checks completed: 939 Node tests, isolated PostgreSQL tests for access isolation/audit failure/obsolete-value rejection/cleanup, lint, translation parity and production build. Desktop UI verification covers reopening and page reload, explicit retrieval, masking/clearing, browser-storage exclusion, partial failure, retry and dispatcher exclusion. All 12 focused password UI tests passed after the final changes; the other Profile checks passed in the broader run. A live native Vault encryption/decryption check with a noncredential sample passed inside a rolled-back transaction. Anonymous requests to both deployed Edge endpoints returned 401. Live grants confirm that anonymous/authenticated roles cannot access either the private table or reveal RPC. The live authenticated localhost page successfully queried availability and displayed the expected no-saved-copy state for the existing driver.

The security advisor reports an intentional INFO for private RLS with no policies (all ordinary access denied), plus pre-existing signed-in SECURITY DEFINER and disabled leaked-password warnings. The new service-only RPCs are not executable by signed-in/anonymous roles.

Reference: [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase password storage](https://supabase.com/docs/guides/auth/password-security#how-are-passwords-stored).
