# T57 — Recover legacy queues and unresolved offline operations safely

**Status:** Planned; implementation has not started.  
**Task ID:** T57  
**Feature:** Offline recovery  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T31](./T31_append-late-transaction-and-refund-closeout-amendments.md), [T53](./T53_add-ordered-idempotent-server-synchronization-protocol.md), [T54](./T54_unify-retry-scheduling-and-multi-tab-synchronization.md), [T55](./T55_expose-offline-queue-truth-and-scoped-offline-checkout.md), [T56](./T56_add-compatible-offline-app-shell-caching-and-update-gating.md), [T42](./T42_add-digital-earnings-and-reconciliation-reporting.md)

## Objective

Every migrated/pending operation remains traceable to confirmed outcome or explicit unresolved case without rewriting cashier identity.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/lib/offline-db.ts`
- `kodigo-ui/src/pages/ReconciliationPage.tsx`
- `kodigo-ui/src/stores/authStore.ts`

## Files to modify

- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/pages/ReconciliationPage.tsx`
- `kodigo-ui/src/stores/authStore.ts`

## New files

- `kodigo-ui/src/lib/offline-recovery.ts`
- `supabase/tests/enhancements/T57_offline_recovery.sql`
- `kodigo-ui/tests/e2e/offline-recovery.spec.ts`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t57_offline_recovery_commands.sql`. Run the pinned CLI's verified `migration new t57_offline_recovery_commands` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M12 conflict decisions/recovery events with original actor, separate synchronizer, source hash/ack and case uniqueness. No reattribution or silent source deletion.

## Backend work

Supervisor recover/associate existing sale/record authorized compensating resolution APIs. Legacy v1 sales lack escrow: detect already committed ID first, otherwise reconcile physical/cash evidence explicitly instead of pretending valid grant.

## Frontend work

Encrypted export/import, stuck/auth/conflict review, original-vs-server comparison, no delete unacknowledged button; generic mutation entries quarantined with explicit resolution.

## Business rules

B09. Malformed generic mutation preserved; no arbitrary table replay or auto-renumber after timeout. Lost device escrow not auto released.

## Implementation steps

1. Inventory v1 sales/generic entries and preserve originals/encrypted recovery copies.
2. Detect prior committed IDs/hash differences, route valid new lease operations normally and legacy uncertain cases to supervised reconciliation.
3. Implement audited reviewer resolutions/compensations and linked late closeout amendments.
4. Test revoked/original actor absent, key-loss incident, corrupt record, interrupted export/import and duplicate recovery.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Legacy sale already committed but queue still pending, insufficient physical stock, missing customer PII, parent-child generic writes half committed.

## Tests

V26,V38,V40,V42,V43,V47; no silent discard or duplicate recovery. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Every migrated/pending operation remains traceable to confirmed outcome or explicit unresolved case without rewriting cashier identity. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T57
npm run test:e2e -- tests/e2e/offline-recovery.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

