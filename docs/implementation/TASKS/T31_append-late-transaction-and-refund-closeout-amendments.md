# T31 — Append late transaction and refund closeout amendments

**Status:** Planned; implementation has not started.  
**Task ID:** T31  
**Feature:** Reconciliation  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T28](./T28_freeze-watermarked-cashier-closeout-snapshots.md), [T29](./T29_add-independent-closeout-review-comments-and-decisions.md), [T22](./T22_confirm-refunds-with-independent-cash-or-external-settlement.md), [T30](./T30_build-cashier-closeout-and-administrator-review-screens.md)

## Objective

Late activity is explainable without changing previously approved totals or hiding liabilities.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/closeouts.ts`
- `kodigo-ui/src/pages/CloseoutReviewsPage.tsx`
- `kodigo-ui/src/lib/refunds.ts`

## Files to modify

- `kodigo-ui/src/lib/closeouts.ts`
- `kodigo-ui/src/pages/CloseoutReviewsPage.tsx`

## New files

- `supabase/tests/enhancements/T31_closeout_amendments.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t31_post_closeout_adjustments.sql`. Run the pinned CLI's verified `migration new t31_post_closeout_adjustments` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M08 closeout_adjustments and linked amendment snapshots/reviews, source-effect unique key; original submitted/approved snapshot protected.

## Backend work

record_late_shift_effect and prepare/review_amendment; original shift for late offline cash, current shift for subsequent cash refund, original sale/closeout reference in both.

## Frontend work

Original/adjustments/reconciled columns, pending case links and approval history.

## Business rules

B07. No silent total rewrite or duplicate late effect. Cash balances are shift-scoped: late old-shift cash changes old expected only, not active-shift available funds already counted in opening; current refund charges performing custody.

## Implementation steps

1. Identify closed-shift late source using immutable shift/operation ID, not guessed date range.
2. Append movement/fact and exactly one adjustment case; snapshot amendment separately.
3. Bind refund post-close path and reserve offline-ingest hook.
4. Test original hash unchanged, independent review and repeated late source.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Approved report, exception closeout unresolved work, backdated untrusted local timestamp, multiple amendments.

## Tests

V20,V24–V26,V38; original bytes unchanged and reconciled totals equal facts. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Late activity is explainable without changing previously approved totals or hiding liabilities. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T31
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

