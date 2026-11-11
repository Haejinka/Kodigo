# T56 — Add compatible offline app-shell caching and update gating

**Status:** In progress; versioned static shell caching and compatible-update gating are implemented and the offline login shell passed both production-preview and deployed-origin browser checks. Pending-outbox and lease compatibility combinations remain for supported workflows.  
**Task ID:** T56  
**Feature:** Offline cold launch  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T50](./T50_migrate-indexeddb-to-a-durable-encrypted-operation-outbox.md), [T51](./T51_issue-bounded-offline-cashier-authorization-leases.md)

## Objective

Supported device can reopen previously installed shell offline without leaking API data or losing pending operations.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/vite.config.ts`
- `kodigo-ui/src/main.tsx`
- `kodigo-ui/index.html`

## Files to modify

- `kodigo-ui/src/main.tsx`
- `kodigo-ui/vite.config.ts`
- `kodigo-ui/index.html`
- `kodigo-ui/playwright.config.ts`
- `.github/workflows/ci.yml`
- `kodigo-ui/tests/e2e/harness.spec.ts`

## New files

- `kodigo-ui/public/service-worker.js`
- `kodigo-ui/public/manifest.webmanifest`
- `kodigo-ui/src/lib/app-shell.ts`
- `kodigo-ui/tests/e2e/offline-app-shell.spec.ts`

## Additional implementation artifact

- `kodigo-ui/scripts/service-worker-template.js` — emitted by Vite with a content-specific cache name and exact built-asset allowlist.

## Database changes

None.

## Backend work

None. No background transfer/provider worker.

## Frontend work

Minimal versioned static app-shell cache after online visit, navigation fallback, compatible active bundle while pending outbox, update prompt after contract check. Never cache authenticated API/PII/tokens.

## Business rules

A07/B09. Cold offline start unlocks existing lease only; no fresh offline login; online-only behavior remains if device gate not met.

## Implementation steps

1. Register versioned SW with explicit generated static asset allowlist and no Supabase/network API cache — implemented.
2. Support SPA navigation fallback and first-online install — implemented.
3. Gate the update prompt on IndexedDB schema, queued command contract, lease encryption, and key-wrapper compatibility; require a single open tab before immediate activation — implemented.
4. Exercise built-bundle offline reload and API cache exclusion in hosted Chromium CI, then run the same read-only offline launch smoke against the deployed HTTPS origin — both passed in run #135. Test prior install/expired lease/update combinations as their offline authorization workflows become available.
5. Record actual results, skipped checks, and remaining gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Stale shell/security update, multiple tabs, corrupt cache, uninstalled app, cached API response leakage.

## Tests

V40,V44; inspect cache allowlist and real offline browser restart. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Supported device can reopen previously installed shell offline without leaking API data or losing pending operations. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

The offline shell browser test runs against Vite's production preview in hosted CI. No local app test/build/lint command is run under the user's instruction to verify deployed changes remotely.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/offline-app-shell.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

