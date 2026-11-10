# T16 — Extend return intake and disposition schema

**Status:** Planned; implementation has not started.  
**Task ID:** T16  
**Feature:** Returns data  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md), [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md)

## Objective

New intake can represent disposition/inspection independently from refund; old records remain readable.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_19_transaction_lifecycle_auth_ops.sql`
- `migration_34_bulk_purchase_base_units.sql`
- `supabase/migrations/20260930130000_consignment_inventory_lots.sql`

## Files to modify

None.

## New files

- `kodigo-ui/src/types/returns.ts`
- `supabase/tests/enhancements/T16_return_schema.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t16_physical_return_models.sql`. Run the pinned CLI's verified `migration new t16_physical_return_models` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M05 additive workflow_state/operation/acceptance/credit fields; item disposition/base snapshot/inspection/location; immutable disposition events; preserve old status/refund/restocked fields as legacy.

## Backend work

State transition validation and direct-write denial only; attach stock movement return/item FKs.

## Frontend work

Typed separate physical intake/credit/refund status models.

## Business rules

B05. Legacy records keep historical truth, no automatic reclassification damaged vs restockable beyond known boolean.

## Implementation steps

1. Add fields/events/FKs/indexes without destructive enum changes.
2. Mark legacy returns with provenance and map restocked boolean conservatively.
3. Add same-sale/location checks and immutable event rules.
4. Validate migrated reads and separate physical/payment states.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Old return has refunded total but missing allocations; fully refunded sale; archived product.

## Tests

V11,V12,V15,V47,V51. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

New intake can represent disposition/inspection independently from refund; old records remain readable. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T16
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

