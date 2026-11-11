# T04 — Add inventory locations and structured ledger fields

**Status:** In progress; additive schema and shadow reconciliation are applied to the existing project. T05/T06 write-path gates and isolated behavior tests remain.
**Task ID:** T04  
**Feature:** Inventory foundation  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T02](./T02_add-operation-identity-and-replay-contract.md), [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md)

## Objective

Existing app still reads unchanged stock; shadow reconciliation explicitly reports mismatches and no historical record is overwritten.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_20_product_selling_options.sql`
- `migration_40_inventory_consumption_history.sql`
- `supabase/migrations/20260930130000_consignment_inventory_lots.sql`

## Files to modify

- `docs/implementation/TASK_STATUS.md`
- `docs/implementation/SCHEMA_BASELINE.md`

## New files

- `supabase/tests/enhancements/T04_inventory_schema.sql`
- Applied-history-aligned `supabase/migrations/20261111043255_t04_inventory_ledger_structure.sql` (CLI-generated as `20261110203314_t04_inventory_ledger_structure.sql`)
- Forward fix `supabase/migrations/20261111043438_t04_fix_uuid_batch_cursors.sql` (CLI-generated as `20261111043350_t04_fix_uuid_batch_cursors.sql`)
- Applied-history-aligned `supabase/migrations/20261111043523_t04_inventory_shadow_constraints.sql` (CLI-generated as `20261110205156_t04_inventory_shadow_constraints.sql`)

The constraints migration is deliberately separate: apply the structure, run the bounded idempotent lot-location, product-balance, and lot-location-balance helpers in committed batches, reconcile, then validate constraints. The existing project was the only target under the user's explicit additive-migration authorization. No separate project, branch, or backup database was created. The first backfill attempt exposed that PostgreSQL has no `max(uuid)` aggregate; the failed call rolled back without changing lots, and the forward migration fixed all three UUID cursors before backfill continued. Destructive rollback and concurrency tests remain isolated-target-only and were not run against this populated project.

## Database changes

M02 locations, shadow balances, original-lot/location balances, movement-lot links/cutovers; extend existing inventory_movements and allocation counters with nullable source links. Add arithmetic/unique/index/append-only controls for new-version rows; keep legacy rows labeled.

## Backend work

Read-only reconciliation query over product, lots and shadow balances; no new writer/cutover enabled. Later return/void FKs attached when tables exist.

## Frontend work

None.

## Business rules

B06/A06. One default sellable+quarantine per store. Preserve integers for sale policy and six-decimal receipt-lot/allocation costs. Deployed legacy sale-line `cost_per_base_unit` is `numeric(12,4)`; retain its historical precision and provenance, and seed only from verified source lots. No competing movement ledger.

## Implementation steps

1. Add schema/indexes/RLS with compatibility nullable fields.
2. Seed default locations and shadow current balances in resumable batches; do not create fabricated historic movement chains.
3. Report lot/product discrepancies and legacy provenance gaps.
4. Validate constraints on new rows and historical readability.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Zero stock, archived product, deleted legacy source, six-decimal cost, old invalid arithmetic, store cascade risk.

## Tests

V47,V48,V51; migration over restored fixtures, same-store FK denial and append-only checks. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Existing app still reads unchanged stock; shadow reconciliation explicitly reports mismatches and no historical record is overwritten. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T04
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

