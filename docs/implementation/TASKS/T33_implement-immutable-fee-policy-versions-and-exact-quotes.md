# T33 — Implement immutable fee policy versions and exact quotes

**Status:** Planned; implementation has not started.  
**Task ID:** T33  
**Feature:** Digital fees  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T32](./T32_add-nonstock-service-catalog-and-digital-account-models.md)

## Objective

Every example matches request and exactly one fee policy applies to each service transaction.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/utils.ts`
- `kodigo-ui/src/types/digital-services.ts`

## Files to modify

None.

## New files

- `kodigo-ui/src/lib/digital-service-quotes.ts`
- `kodigo-ui/scripts/unit/digital-service-quotes.test.mjs`
- `supabase/tests/enhancements/T33_fee_policies.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t33_service_fee_policies.sql`. Run the pinned CLI's verified `migration new t33_service_fee_policies` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M09 fee policy versions/ranges/effective interval checks, one selected policy snapshot; admin-only version creation.

## Backend work

quote_digital_service canonical SQL; load2% discounted cost, cashin3%, cashout bands and selectable percent2 replacing default. Freeze quote version after reserve.

## Frontend work

Decimal-string preview using identical golden fixtures, never authoritative commit math.

## Business rules

B02/B08 worked examples. No stacking; customer pays full load face; commission not wallet credit.

## Implementation steps

1. Seed explicit default and alternative policies with nonoverlap validation.
2. Implement principal/bounds/rate/flat quote and exact rounding/cost/earning conservation.
3. Expose quote/version and admin create-new-version command.
4. Test all amount boundaries, examples and old snapshot unchanged after policy update.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

49.99/50/100/100.01 cashout, selected percent2 below standard min requires explicit supported range policy, ambiguous active policies, cent rounding.

## Tests

V27–V30,V18 golden SQL/Node parity. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Every example matches request and exactly one fee policy applies to each service transaction. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T33
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

