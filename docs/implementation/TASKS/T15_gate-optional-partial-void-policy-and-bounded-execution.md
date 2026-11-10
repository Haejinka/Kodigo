# T15 — Gate optional partial void policy and bounded execution

**Status:** Planned; implementation has not started.  
**Task ID:** T15  
**Feature:** Optional partial void  
**Priority:** Medium  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T13](./T13_apply-full-void-with-source-stock-and-confirmed-money-reversal.md), [T14](./T14_add-cashier-void-requests-and-supervisor-review-ui.md), [T17](./T17_validate-physical-return-quantity-and-monetary-entitlement.md), [T21](./T21_implement-credit-and-capture-allocation-for-refunds.md)

## Objective

Default deployment rejects partial void; approved enabled policy cannot overrestore/overcredit or bypass independent approval.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/voids.ts`
- `kodigo-ui/src/components/pos/VoidRequestDialog.tsx`

## Files to modify

- `kodigo-ui/src/lib/voids.ts`
- `kodigo-ui/src/components/pos/VoidRequestDialog.tsx`

## New files

- `supabase/tests/enhancements/T15_partial_voids.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t15_partial_void_policy.sql`. Run the pinned CLI's verified `migration new t15_partial_void_policy` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Use M04 line quantities and M03 cumulative allocations; enforce server partial_voids false until D02 approval; no new enum.

## Backend work

Extend same apply policy for approved unfulfilled line subsets, shared return/credit entitlement, exact source restoration, partial/full void_state.

## Frontend work

Only expose line selection after server policy enabled; display net/tax/discount quote and remaining units.

## Business rules

B04/B05. D02 unresolved: implement disabled branch/tests first; enabling requires recorded policy. Never label return/refund as void.

## Implementation steps

1. Record D02 approval or keep flag false and report feature unavailable.
2. Add shared cumulative line entitlement checks including returns/credits.
3. Apply only approved units/value through same helpers, with final residual cents.
4. Verify partial then full outcomes and concurrent return race.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

2of5 void then4 return, full-discount line, externally fulfilled subset, request quote stale.

## Tests

V08,V14,V18; flag-off rejection required regardless business decision. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Default deployment rejects partial void; approved enabled policy cannot overrestore/overcredit or bypass independent approval. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T15
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

