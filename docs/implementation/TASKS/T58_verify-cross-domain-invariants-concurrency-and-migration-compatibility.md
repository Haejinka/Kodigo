# T58 — Verify cross-domain invariants concurrency and migration compatibility

**Status:** Planned; implementation has not started.  
**Task ID:** T58  
**Feature:** Integrity verification  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T13](./T13_apply-full-void-with-source-stock-and-confirmed-money-reversal.md), [T19](./T19_apply-return-disposition-and-inspection-transfers-to-source-lots.md), [T22](./T22_confirm-refunds-with-independent-cash-or-external-settlement.md), [T31](./T31_append-late-transaction-and-refund-closeout-amendments.md), [T42](./T42_add-digital-earnings-and-reconciliation-reporting.md), [T46](./T46_add-configurable-customer-rankings-using-shared-facts.md), [T49](./T49_add-shopping-list-preview-print-and-explicit-reprint-ui.md), [T57](./T57_recover-legacy-queues-and-unresolved-offline-operations-safely.md)

## Objective

No listed invariant fails in isolated deterministic/concurrent runs; failures are fixed by owning task before rollout.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/scripts/integration-checkout-stock-rls.mjs`
- `kodigo-ui/scripts/run-enhancement-db-tests.mjs`
- `supabase/tests/enhancements/`
- `kodigo-ui/scripts/unit/`

## Files to modify

- `kodigo-ui/scripts/integration-checkout-stock-rls.mjs`
- `kodigo-ui/scripts/run-enhancement-db-tests.mjs`

## New files

- `kodigo-ui/scripts/enhancement-invariants.mjs`
- `supabase/tests/enhancements/T58_invariants.sql`
- `supabase/tests/enhancements/T58_concurrency.sql`
- `supabase/tests/enhancements/T58_migration_compatibility.sql`

## Database changes

Only isolated fixtures/assertions; no new production business schema. Add missing constraints only through the owning task's reviewed forward fix if a failure exposes gap.

## Backend work

Real independent transaction barriers and seeded state-sequence tests; reconcile stock/cash/wallet/credits/provider/earnings and approved closeout hashes. Cover current v5, not only old v3.

## Frontend work

Unit invariants for previews, retry policy and print commands; not implementation-mirroring tests.

## Business rules

All B01–B10 invariants and TEST_MATRIX. Partial enabled tests require D02/T15; default-disabled test always required.

## Implementation steps

1. Add seeded generate/replay/reorder operation sequences and retain seed on failure.
2. Exercise simultaneous sale/return/void/refund/drawer/closeout/grant with two DB connections.
3. Run empty and restored migration snapshots and inspect effective grants/triggers/hash preservation.
4. Update legacy integration harness to v5 and ensure old signatures cannot bypass; report skip distinctly.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Crash at every transaction boundary, final cent, mixed legacy/current financial formats, consignment obligation, unknown external outcome.

## Tests

V01–V52; all invariants after each committed operation and rollback after injected failure. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

No listed invariant fails in isolated deterministic/concurrent runs; failures are fixed by owning task before rollout. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run test:unit; npm run test:db:enhancements -- --case T58; node scripts/enhancement-invariants.mjs; npm run test:integration (isolated opt-in only)
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

