# T54 — Unify retry scheduling and multi-tab synchronization

**Status:** Planned; implementation has not started.  
**Task ID:** T54  
**Feature:** Offline runner  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T50](./T50_migrate-indexeddb-to-a-durable-encrypted-operation-outbox.md), [T53](./T53_add-ordered-idempotent-server-synchronization-protocol.md)

## Objective

No hot retry loop, permanent error starvation or duplicate sale; scheduler resumes safely and records every outcome.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/App.tsx`

## Files to modify

- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/App.tsx`

## New files

- `kodigo-ui/src/lib/sync-runner.ts`
- `kodigo-ui/scripts/unit/sync-policy.test.mjs`
- `kodigo-ui/tests/e2e/offline-sync.spec.ts`

## Database changes

No new schema; T53 server idempotency remains authoritative.

## Backend work

None beyond typed protocol; no generic direct-table replay.

## Frontend work

One scheduler for startup/focus/online/visibility/backoff, IDB lease heartbeat/CAS+BroadcastChannel, terminal sequence ordering, durable state/ack, full jitter1–60s,429 delay, crash recovery.

## Business rules

B09. Network hint not truth; transport retries same ID; domain/auth errors visible blocked states, never dropped. Browser closed means no promised worker sync.

## Implementation steps

1. Replace duplicate listeners with one lifecycle-managed runner.
2. Implement transient/domain/auth classification and persisted attempts/nextRetry.
3. Acquire cross-tab lease, recover stale syncing work and ack before advancing.
4. Simulate concurrent tabs and crash/timeout at each commit/ack point.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Server500/429, clock changes, tab sleeps, lease race, offline probe false positives, IDB ack write fails after server success.

## Tests

V38–V42; deterministic retry unit tests plus real multi-tab browser scenario. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

No hot retry loop, permanent error starvation or duplicate sale; scheduler resumes safely and records every outcome. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/offline-sync.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

