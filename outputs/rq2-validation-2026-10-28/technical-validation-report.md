# Kodigo RQ2 security remediation validation

Assessment date: 28 October 2026 (Asia/Manila). This follow-up preserves the original [27 October assessment](../rq2-validation-2026-10-27/controlled-security-results-v2.json) as the baseline.

**Result: both targeted database authorization failures were reproduced before the patch, then passed after the migration was applied to the connected KodiGo Supabase project.** The checks used rollback-only synthetic fixtures.

## Root causes and changes

### DB17 — Store creation bypassed MFA assurance

`public.create_store_with_owner` queried `profiles.role` directly. That check authorized an enrolled administrator at AAL1 without consulting the existing MFA-aware helpers. The function now uses `public.current_user_role()`, which returns no role for an enrolled user until the JWT reaches AAL2. The existing admin-only role rule and atomic store plus owner-membership inserts are retained. The function now has an empty search path and anonymous execution is revoked.

Related privileged routines were inspected. `close_cashier_shift` and `process_pos_sale_v2/v3/v4` also read profile roles directly, but each calls `public.user_belongs_to_store()`, which applies `private.mfa_session_is_valid()`. I found no second store-creation path with the same bypass.

### DB20 — Audit logging accepted unauthenticated writes

`public.log_audit_event` was a `SECURITY DEFINER` function with a mutable `public` search path and no caller or scope validation. Its grants allowed both `anon` and `authenticated` roles to call it directly; its insert used `auth.uid()` even when that value was null.

The function now uses an empty search path, rejects missing user identity except for a trusted `service_role` JWT, and checks authenticated callers against the target store with `public.user_belongs_to_store()`. The audit actor is always derived from `auth.uid()`. Direct execution is revoked from `PUBLIC`, `anon`, and `authenticated`; the owner can still invoke it from the existing `SECURITY DEFINER` business routines, and `service_role` retains its server-side grant.

## Migration and deployment

- Added [`20261027191635_harden_store_creation_and_audit_logging.sql`](../../supabase/migrations/20261027191635_harden_store_creation_and_audit_logging.sql).
- Applied it to the connected **KodiGo Database** project (Postgres 17.6.1.084, ap-northeast-1). The Supabase migration ledger records version `20261027192054`, name `harden_store_creation_and_audit_logging`.
- Post-apply metadata confirmed `create_store_with_owner`: `anon_exec=false`, `authenticated_exec=true`; `log_audit_event`: `anon_exec=false`, `authenticated_exec=false`, `service_role_exec=true`. Both functions have `search_path=''`.
- The MFA helper exists in the database although its migration is absent from the retrieved ledger. The migration guide now places this patch after root migration 40 because root migration 36 defines the earlier store-creation routine.
- Store creation remains admin-only, matching the deployed routine and migration 36. A separate local-only Super Admin access proposal remains unapplied.

## Before and after results

| Check | Before migration | After migration |
|---|---|---|
| Full controlled DB suite | 20 passed, 2 failed | 22 passed, 0 failed |
| DB16: enrolled AAL1 user fails store authorization | PASS | PASS |
| DB17: enrolled AAL1 user cannot create a store | FAIL: store created | PASS: rejected; no store or membership remains |
| DB18: enrolled AAL2 user passes assigned-store authorization | PASS | PASS |
| DB20: anonymous caller cannot insert audit event | FAIL: event inserted | PASS: permission denied |
| Focused regression | — | PASS |

The focused regression also confirmed that an enrolled admin can create a store at AAL2, a non-enrolled admin at AAL1 retains the existing opt-in MFA behavior, cashier and inventory roles cannot create stores, authenticated users cannot call the audit helper directly, and an out-of-store identity is rejected by the helper body. A valid nested POS sale still wrote an audit event attributed to the cashier. A `service_role` system event also succeeded with a null end-user actor.

The post-test cleanup query found zero synthetic Auth users, profiles, stores, memberships, categories, products, sales, or audit events. The detailed result summary is in [`controlled-security-results-2026-10-28.json`](controlled-security-results-2026-10-28.json); the regression SQL is [`store_creation_and_audit_security.sql`](../../supabase/tests/store_creation_and_audit_security.sql).

## Local checks

- TypeScript typecheck: passed.
- ESLint: passed.
- Unit tests: 17 passed, 0 failed.
- Production build: passed. Existing bundle warnings remain for mixed dynamic/static imports of `jspdf` and `write-excel-file`, and a 2.15 MB minified main chunk.
- The repository service-role integration harness was not run because its dedicated test credentials were unavailable.

## Scope and remaining concerns

Database tests simulated Postgres roles and `request.jwt.claims`; they did not test Auth-issued sessions, real TOTP verification, or the PostgREST HTTP gateway. The migration and post-apply function grants were verified in the connected database, but end-to-end sign-in/MFA behavior remains untested.

The post-migration security advisor no longer reports `log_audit_event` as callable by anonymous or authenticated users. `create_store_with_owner` remains callable by `authenticated` by design and enforces its admin and MFA checks in the database. Other global advisor findings remain: 16 anonymous-executable and 37 authenticated-executable `SECURITY DEFINER` functions, 10 mutable function search paths, one RLS-enabled table without a policy, and leaked-password protection disabled. Those findings were not all reviewed or changed as part of this remediation.
