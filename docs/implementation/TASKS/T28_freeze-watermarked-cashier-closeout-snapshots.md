# T28 — Freeze watermarked cashier closeout snapshots

**Status:** Planned; implementation has not started.  
**Task ID:** T28  
**Feature:** Closeout core  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T26](./T26_bind-checkout-void-and-refund-cash-to-real-shifts.md), [T27](./T27_add-shift-opening-and-authorized-cash-movement-ui.md)

## Objective

Closeout can be reproduced from fixed source facts and never depends on later mutable sale status.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_19_transaction_lifecycle_auth_ops.sql`
- `kodigo-ui/src/lib/transactions.ts`
- `kodigo-ui/src/types/index.ts`

## Files to modify

- `kodigo-ui/src/lib/transactions.ts`
- `kodigo-ui/src/types/index.ts`

## New files

- `kodigo-ui/src/types/closeouts.ts`
- `kodigo-ui/src/lib/closeouts.ts`
- `supabase/tests/enhancements/T28_closeout_snapshot.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t28_closeout_snapshots.sql`. Run the pinned CLI's verified `migration new t28_closeout_snapshots` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M08 snapshot/header/items/hash/watermarks/pending operation list, review_state/schema_version; one initial snapshot per shift. Preserve legacy rows/status as legacy, not auto-approved.

## Backend work

prepare/submit_closeout and build_snapshot under shift lock; block new operations during closing, include committed facts by watermark; known pending work blocks normal submit, admin exception enumerates it.

## Frontend work

Typed snapshot preview showing all required subtotals and expected/count/variance; opening read-only from shift.

## Business rules

B03/B07. Closing count delta0; approved/submitted snapshots immutable; use explicit IDs and half-open report windows.

## Implementation steps

1. Add immutable snapshot schema and stable grouping/source-item rows.
2. Freeze shift and capture watermarks/pending operations atomically.
3. Compute physical expected from cash ledger plus financial/service subtotals without mixing principal/revenue.
4. Compare independent recomputation and concurrent checkout/submit boundaries; retire old closeout bypass.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Repeated submit, midnight/timezone, late provider leg, pending offline queue, actor who performed refund differs.

## Tests

V21,V24,V26,V51; snapshot source IDs/totals/hash stable. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Closeout can be reproduced from fixed source facts and never depends on later mutable sale status. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T28
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

