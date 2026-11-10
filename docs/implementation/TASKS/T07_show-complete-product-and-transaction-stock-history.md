# T07 — Show complete product and transaction stock history

**Status:** Planned; implementation has not started.  
**Task ID:** T07  
**Feature:** Inventory UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T06](./T06_route-all-existing-stock-writers-through-the-ledger.md)

## Objective

A cashier with permitted read can explain a stock change without generic audit reconstruction; all stock categories visible.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/inventory/StockAdjustmentLog.tsx`
- `kodigo-ui/src/pages/InventoryPage.tsx`
- `kodigo-ui/src/lib/reporting.ts`
- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`

## Files to modify

- `kodigo-ui/src/components/inventory/StockAdjustmentModal.tsx`
- `kodigo-ui/src/pages/InventoryPage.tsx`
- `kodigo-ui/src/components/inventory/StockAdjustmentLog.tsx`

## New files

- `kodigo-ui/src/lib/inventory-movements.ts`
- `kodigo-ui/src/components/inventory/InventoryMovementHistory.tsx`
- `supabase/tests/enhancements/T07_movement_reads.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t07_inventory_history_reads.sql`. Run the pinned CLI's verified `migration new t07_inventory_history_reads` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Guarded get_inventory_movements with product/location/type/actor/date keyset cursor and indexes from M02; no ledger changes.

## Backend work

Return actor/reference/approval/conversion and before-after; enforce same-store/role with page≤100.

## Frontend work

Complete timeline in inventory/product/transaction contexts; signed amounts, labels, locations, source links and cutover banner. Remove arbitrary PO note hiding. Extend StockAdjustmentModal with decrease/correction request, pending approval and approved apply; never change stock while pending.

## Business rules

B06/UI inventory contract. Cached adjustment list is not complete movement history.

## Implementation steps

1. Implement cursor read RPC and typed mapper.
2. Adapt existing log styling and add filters/expansion/reference navigation.
3. Add product/transaction-scoped entry points and availability/quarantine summary.
4. Verify empty/loading/error/denied and cursor behavior.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Deleted legacy source, actor archived, large history, foreign-store cursor, hidden legacy provenance.

## Tests

SQL paging/authorization plus browser timeline assertions V11,V12,V48; manual accessible keyboard/filter check. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

A cashier with permitted read can explain a stock change without generic audit reconstruction; all stock categories visible. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T07
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

