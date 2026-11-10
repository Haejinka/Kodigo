# T18 — Record accepted returns and credits without automatic refund

**Status:** Planned; implementation has not started.  
**Task ID:** T18  
**Feature:** Return intake  
**Priority:** High  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T17](./T17_validate-physical-return-quantity-and-monetary-entitlement.md), [T05](./T05_implement-the-centralized-stock-mutation-service.md), [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md)

## Objective

Return record, credit and physical disposition are auditable; refund remains a distinct action.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/transactions.ts`
- `migration_34_bulk_purchase_base_units.sql`

## Files to modify

- `kodigo-ui/src/lib/transactions.ts`

## New files

- `kodigo-ui/src/lib/returns.ts`
- `supabase/tests/enhancements/T18_return_intake.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t18_return_intake_service.sql`. Run the pinned CLI's verified `migration new t18_return_intake_service` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M05 return/items/claims plus M03 posted credit source uniqueness; no negative sale_payment inserted by intake.

## Backend work

submit_sale_return/accept_sale_return command APIs, independent approval where required, original-line locks and idempotency. Create accepted credit once; physically received items route T19 disposition service.

## Frontend work

Typed intake/accept APIs; old returnSaleItems facade must reject old automatic-refund behavior or explicitly compose two separately authorized operations.

## Business rules

B03/B05. New returns never imply payment reversal; prior goodwill allocated to returned units prevents extra credit.

## Implementation steps

1. Validate and persist submitted physical claims with reason/disposition.
2. Accept authorized quantities and create exact credit using T08.
3. Record intake/disposition event and audit, calling only centralized stock helper for accepted physical effects.
4. Retire old direct auto-refund endpoint or enforce upgrade-required; prove pending/accepted/refund states.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Response loss, rejected intake releasing claims, return after full refund, zero-credit acceptance, mid-credit failure.

## Tests

V11,V14,V15,V17,V52; intake has zero new payment/cash rows. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Return record, credit and physical disposition are auditable; refund remains a distinct action. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T18
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

