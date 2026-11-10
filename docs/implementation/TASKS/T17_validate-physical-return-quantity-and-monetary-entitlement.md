# T17 — Validate physical return quantity and monetary entitlement

**Status:** Planned; implementation has not started.  
**Task ID:** T17  
**Feature:** Return validation  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T16](./T16_extend-return-intake-and-disposition-schema.md)

## Objective

No combination of damaged/restocked/inspection/void claims exceeds sold units; financial state cannot erase physical entitlement.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_34_bulk_purchase_base_units.sql`
- `kodigo-ui/src/lib/transactions.ts`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T17_return_eligibility.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t17_return_eligibility.sql`. Run the pinned CLI's verified `migration new t17_return_eligibility` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Eligibility helper/read RPC and quantity claim checks over submitted/accepted return items and applied voids.

## Backend work

get_return_eligibility and locked validator: same original line/store, duplicate line reject, sold minus physical/reserved/void quantities, existing credits and service exclusion.

## Frontend work

Expose quantities/disposition options/credit availability to later UI; never default all returned.

## Business rules

B05. All dispositions consume physical entitlement. Fully refunded status alone does not prevent goods intake.

## Implementation steps

1. Centralize cumulative physical claims and share with void eligibility.
2. Calculate credit using historical net price/cumulative cents and prior monetary allocations.
3. Return explicit ineligible reasons/service behavior.
4. Run concurrent two-return/return-void eligibility tests.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Nonrestockable earlier return, duplicate item IDs, refunded yet outstanding goods, same ID retry, partial credit already granted.

## Tests

V14,V15,V18 and requester/foreign-store rejection. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

No combination of damaged/restocked/inspection/void claims exceeds sold units; financial state cannot erase physical entitlement. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T17
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

