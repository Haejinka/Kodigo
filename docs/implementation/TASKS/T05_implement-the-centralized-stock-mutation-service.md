# T05 — Implement the centralized stock mutation service

**Status:** In progress; private service migration is deployed, but operational write-path acceptance remains unverified.
**Task ID:** T05  
**Feature:** Inventory correctness  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T04](./T04_add-inventory-locations-and-structured-ledger-fields.md)

## Objective

All helper effects are atomic/idempotent; no direct grant lets a cashier invoke low-level stock posting.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_34_bulk_purchase_base_units.sql`
- `migration_37_unit_aware_inventory_workflow.sql`
- `supabase/migrations/20260930130000_consignment_inventory_lots.sql`
- `supabase/migrations/20261019120000_pos_reporting_and_consignment_revisions.sql`

## Files modified

- `supabase/tests/enhancements/T05_inventory_service.sql` — deployed catalog and authorization assertions.
- `docs/implementation/TASK_STATUS.md` — actual implementation and verification state.
- `docs/implementation/SCHEMA_BASELINE.md` — applied migration version and deployed schema evidence.

## New files

- `supabase/tests/enhancements/T05_inventory_service.sql`
- CLI-generated migration: `supabase/migrations/20261111045323_t05_inventory_mutation_service.sql`. Supabase recorded applied version `20261111052012`; the checked-in path is aligned to that deployed history as `supabase/migrations/20261111052012_t05_inventory_mutation_service.sql`. A CLI-generated forward fix `20261111052420_t05_fix_quarantine_release_recovery.sql` was recorded as `20261111052533` and is checked in as `supabase/migrations/20261111052533_t05_fix_quarantine_release_recovery.sql`. Do not hand-invent the timestamp.

## Database changes

M02 helper and operation-local deferred consistency constraints; balance/version and source-lot uniqueness; source counter additions per M02.

## Backend work

apply_inventory_movement, FIFO allocation and source-exact restore helpers over inventory_balances and inventory_lot_location_balances; paired transfer/disposal; original supplier receipt unchanged. Projections updated only here. Lock order A02; movement-lot unit cost copies the immutable six-decimal receipt-allocation cost and COGS recovery is captured once. Do not derive new recovery cost from the legacy four-decimal `sale_items.cost_per_base_unit` snapshot.

## Frontend work

None; service remains feature gated.

## Business rules

B06. One nonzero balance delta→one movement with lot slices; no negative available; compensating entries only; restored/physical counters distinct.

## Implementation steps

1. Prelock balance and lots in deterministic order and validate expected version/available holds.
2. Write balance, lot slices, movement, projection and operation event in one transaction.
3. Implement source-allocation restoration and quarantine transfer with bounds.
4. Force mid-write failure and run concurrent sale/adjustment and restore tests on an isolated database.
5. Run the read-only catalog test on the deployed project; run write-path, rollback and concurrency tests only on the explicitly identified isolated database. Record actual results, unavailable checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Same product multiple options, changed package configuration, mixed ownership/cost lots, restock after damage, zero delta, stock under offline hold.

## Tests

V01,V04,V05,V11–V14,V48; assert arithmetic, lot sum and projection agreement under two connections. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

All helper effects are atomic/idempotent; no direct grant lets a cashier invoke low-level stock posting. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

The catalog test is run against the existing deployed project. The user-directed no-new-database boundary prevents destructive/write-path/concurrency checks until an isolated target is explicitly available; do not use production data for those tests. No local application build, lint, or test commands are run under the active user instruction.

```text
Hosted CI: typecheck, lint, build, and unit suite after push
Hosted Supabase: execute supabase/tests/enhancements/T05_inventory_service.sql
Isolated database required: sale/return/void write paths, injected rollback, wrong-role, and concurrent locking tests
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

