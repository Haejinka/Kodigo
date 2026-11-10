# T19 — Apply return disposition and inspection transfers to source lots

**Status:** Planned; implementation has not started.  
**Task ID:** T19  
**Feature:** Return stock disposition  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T18](./T18_record-accepted-returns-and-credits-without-automatic-refund.md)

## Objective

Every returned unit has clear location/disposition; no damaged goods silently reenter sellable stock.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `supabase/migrations/20260930130000_consignment_inventory_lots.sql`
- `kodigo-ui/src/components/inventory/StockAdjustmentLog.tsx`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T19_return_dispositions.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t19_return_disposition_stock.sql`. Run the pinned CLI's verified `migration new t19_return_disposition_stock` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M02/M05 source-allocation counters, movement-lot and disposition events; quarantine slices retain ownership/cost without new supplier payable.

## Backend work

apply_return_disposition/inspect_return APIs: restockable→sellable; damaged/defective/unsellable/inspection→quarantine on the original lot/location balance, never a duplicate receiving lot. Inspection release paired transfer with COGS recovery event; disposal separate.

## Frontend work

Return adapters expose allowed transition/result movement IDs for T23 UI.

## Business rules

B05/B06. Only restockable increases sellable; all goods count physically returned; exact original lot slices and cost.

## Implementation steps

1. Allocate returned base units against original unreturned allocation slices deterministically.
2. Post appropriate location movements and independent counters through T05.
3. Implement inspected release/disposal as new authorized operations.
4. Disable legacy return lot trigger for new-version items and verify no duplicate restore.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Mixed consigned/store-owned lots, subsequent inspection, goods already refunded, changed option, repeated disposition command.

## Tests

V11–V14,V48; damaged +0 sellable, paired transfer conservation, supplier payable unchanged. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Every returned unit has clear location/disposition; no damaged goods silently reenter sellable stock. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T19
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

