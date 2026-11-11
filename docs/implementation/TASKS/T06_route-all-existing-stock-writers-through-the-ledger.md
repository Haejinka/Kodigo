# T06 — Route all existing stock writers through the ledger

**Status:** In progress; the additive writer/cutover migration and ledger-mode adapters are prepared but not applied or cut over. No production business write has been performed for T06.  
**Task ID:** T06  
**Feature:** Inventory cutover and checkout  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T05](./T05_implement-the-centralized-stock-mutation-service.md)

## Objective

No reachable supported stock writer bypasses T05; one ledger and one balance authority; preserved PO behavior.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/lib/inventory-ledger.ts`
- `kodigo-ui/src/components/inventory/StockAdjustmentModal.tsx`
- `kodigo-ui/src/pages/InventoryPage.tsx`
- `kodigo-ui/src/pages/RestockingPage.tsx`
- `migration_31_receive_po_status_only.sql`
- `migration_34_bulk_purchase_base_units.sql`
- `migration_37_unit_aware_inventory_workflow.sql`
- `supabase/migrations/20261021055145_fix_pos_item_discount_snapshots.sql`

## Files to modify

- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/lib/inventory-ledger.ts`
- `kodigo-ui/src/components/inventory/StockAdjustmentModal.tsx`
- `kodigo-ui/src/pages/InventoryPage.tsx`
- `kodigo-ui/src/pages/RestockingPage.tsx`
- `docs/implementation/API_CONTRACTS.md`
- `docs/implementation/ARCHITECTURE.md`
- `docs/implementation/DATABASE_MIGRATION_PLAN.md`
- `docs/implementation/TASK_STATUS.md`

## New files

- `supabase/tests/enhancements/T06_stock_cutover.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t06_centralize_stock_writers.sql`. Run the pinned CLI's verified `migration new t06_centralize_stock_writers` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M02 gated cutover baseline and trigger replacement, including an immutable `inventory_cutover_items` row for every product (also zero-stock products) and its exact lot-location provenance snapshot; process_pos_sale_v5 command shell retains full v4 pricing/discount/tax/snapshot logic. Revoke direct projection writes; old signatures delegate or fail upgrade-required.

## Backend work

Route sale, product opening stock, manual adjust, supplier receive and legacy reversal stock paths through T05. Manual decreases/corrections request independent approve_inventory_adjustment through T03 infrastructure before apply; live version revalidated. Inventory approvals use the `inventory_ledger_v2` gate; cutover must not enable the generic `approval_workflows` gate for cash and wallet consumers. Disable note-prefix/status-trigger duplicate restores for new operations. Lifecycle money writes stay disabled until T13/T22/T26.

## Frontend work

Thin v5/stock command adapters with stable operation IDs; preserve product form/receiving flow. Do not enable offline v1 fallback.

## Business rules

A06/B02/B06. PO receive remains status-only. Product/options share base stock; original lots and receipt snapshots preserved.

## Implementation steps

1. Characterize effective triggers from T00 and script single-writer cutover transaction.
2. Create baseline boundary after explicit product/lot reconciliation; protect direct stock writes.
3. Switch all listed writers/compatibility signatures, recording each trigger retired/replaced.
4. Reconcile after opening, sale, receive, adjust and legacy-call attempts before enabling store flag.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Old clients/v3 test harness, pending legacy queue, initial stock without lot, archived product reversal, duplicate lot restoration trigger.

## Tests

V01–V05,V48,V51,V52; baseline+new deltas=balance; exactly one movement per stock effect. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

No reachable supported stock writer bypasses T05; one ledger and one balance authority; preserved PO behavior. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T06
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

