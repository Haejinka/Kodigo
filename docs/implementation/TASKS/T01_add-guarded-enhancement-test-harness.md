# T01 — Add guarded enhancement test harness

**Status:** In progress; guarded harness and CI wiring are implemented. The temporary-table SQL case passed on the deployed project in an explicit rollback transaction after fixing its temp-schema identity check. Remote run #112 passed the read-only deployed login-screen Playwright smoke. T00's empty-bootstrap gate and full isolated integration suite remain incomplete under the current no-new-database direction.
**Task ID:** T01  
**Feature:** Foundation testing  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T00](./T00_fingerprint-schema-and-prove-bootstrap-order.md)

## Objective

Task commands in TEST_MATRIX are executable; dangerous targets are rejected and CI never labels a skip as pass.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/package.json`
- `kodigo-ui/scripts/integration-checkout-stock-rls.mjs`
- `README.md`
- `.github/workflows/ci.yml`
- `supabase/tests/`

## Files to modify

- `kodigo-ui/package.json`
- `kodigo-ui/scripts/integration-checkout-stock-rls.mjs`
- `README.md`
- `.github/workflows/ci.yml`

## New files

- `kodigo-ui/scripts/run-enhancement-db-tests.mjs`
- `supabase/tests/enhancements/fixtures.sql`
- `supabase/tests/enhancements/T01_harness.sql`
- `kodigo-ui/playwright.config.ts`
- `kodigo-ui/tests/e2e/harness.spec.ts`
- `kodigo-ui/scripts/enhancement-test-target.mjs`
- `kodigo-ui/scripts/unit/enhancement-test-target.test.mjs`

## Database changes

Synthetic fixtures only in explicit isolated DB; SQL uses transaction/rollback and authenticated role claims. No production schema changes.

## Backend work

Introduce test:db:enhancements -- --case Txx; fail closed without RUN_ENHANCEMENT_DB_TESTS=true and validated test project/database. Execute psql without shell or secrets in logs; detect skipped separately.

## Frontend work

Introduce test:e2e using installed playwright/test and an explicit read-only remote origin opt-in; local server settings use a fake Supabase endpoint and no auth credentials. No new testing framework dependency.

## Business rules

Real-role checks required; service-role tests alone cannot validate authorization. Never auto-enable mutating tests from ambient .env.

## Implementation steps

1. Build test-target identity guard and allowlist SQL cases by task prefix.
2. Create repeatable fixture setup/rollback and a deliberately denied unauthorized example.
3. Add Playwright config with a deterministic fake-backend local server and an explicit read-only remote origin opt-in.
4. Wire explicit-target integration/database CI jobs separately from standard checks so skipped tests cannot appear as passing checks; add an optional read-only deployed login-screen smoke and document required environment names.
5. Run this task's checks only against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Missing psql, secrets absent, CI skip, test SQL failure, malicious --case path, fixture cleanup after crash.

## Tests

Run harness against isolated target; missing/wrong target must fail before writes; expected authorization rejection passes; test rollback leaves no fixture rows. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Task commands in TEST_MATRIX are executable; dangerous targets are rejected and CI never labels a skip as pass. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials. The read-only UI smoke may target the deployed login page only after setting its explicit HTTPS origin and read-only opt-in.

```text
npm run test:unit; npm run test:db:enhancements -- --case T01; npm run test:e2e -- tests/e2e/harness.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

