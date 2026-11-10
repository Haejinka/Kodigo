# T50 — Migrate IndexedDB to a durable encrypted operation outbox

**Status:** In progress; encryption primitives, typed offline metadata, the v2 IndexedDB schema/upgrader, atomic storage APIs, and durable attempt/retry-state transitions are implemented but not connected to POS checkout. Seven real-browser storage/safety tests pass remotely. An encrypted recovery-export slice and its eighth browser test are awaiting remote CI; additional failure modes and integration remain open.
**Task ID:** T50  
**Feature:** Offline storage  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T02](./T02_add-operation-identity-and-replay-contract.md), [T01](./T01_add-guarded-enhancement-test-harness.md)

## Objective

A locally reported saved sale is durably stored once or clearly fails with cart preserved; other actors cannot read its payload.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/stores/authStore.ts`

## Files to modify

- `kodigo-ui/src/lib/offline-sync.ts`
- `.github/workflows/ci.yml`

## New files

- `kodigo-ui/src/lib/offline-db.ts`
- `kodigo-ui/src/lib/offline-crypto.ts`
- `kodigo-ui/src/types/offline.ts`
- `kodigo-ui/tests/e2e/offline-storage.spec.ts`

## Database changes

Client IDB v2 stores per A07; server metadata contract T02 unchanged. Preserve v1 queue originals in legacy_recovery, do not replay automatically.

## Backend work

None; encryption is local at-rest protection, server still validates every command.

## Frontend work

Atomic sequence+queue+grant consumption; encrypted payload/AAD with wrapped in-memory master key, durable acks/state/attempts, partition store/actor/terminal, quota/storage errors visible. Unlock/recovery policy D03 must be recorded before enablement.

## Business rules

A07/B09. AES256-GCM/96-bit IV, PBKDF2-SHA256600000; no key/passphrase beside ciphertext; PII minimization, no unacknowledged deletion.

## Implementation steps

1. Define versioned IDB schema/upgrader and legacy byte-preserving recovery import.
2. Implement crypto envelope/unlock/idle lock with specified AAD and unique IV.
3. Implement one local transaction for outbox+sequence+grant counters and ack persistence.
4. Test blocked upgrade, quota/abort/crash, wrong user/passphrase, encrypted export and v1 retention in a real browser; keep database test targets synthetic and isolated.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

No IndexedDB/private mode, user logout, key forgotten, multi-tab upgrade blocked, crypto unavailable, corrupted payload.

## Tests

V37–V40,V43,V44 in real browser IndexedDB, not only mocks. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

A locally reported saved sale is durably stored once or clearly fails with cart preserved; other actors cannot read its payload. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/offline-storage.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

