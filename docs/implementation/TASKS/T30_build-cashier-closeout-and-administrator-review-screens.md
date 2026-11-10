# T30 — Build cashier closeout and administrator review screens

**Status:** Planned; implementation has not started.  
**Task ID:** T30  
**Feature:** Closeout UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T29](./T29_add-independent-closeout-review-comments-and-decisions.md)

## Objective

Cashier submits accurate fixed report; admin sees evidence and can independently review with clear variance.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## Files to modify

- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## New files

- `kodigo-ui/src/components/pos/CloseoutWizard.tsx`
- `kodigo-ui/src/pages/CloseoutReviewsPage.tsx`
- `kodigo-ui/tests/e2e/closeout-review.spec.ts`

## Database changes

No new models; use T28/T29.

## Backend work

No client reconstruction of approved totals.

## Frontend work

Freeze/pending-sync/count/preview/submit wizard; required summary fields; negative variance explanation; admin comparison/history/review/comments and original snapshot display.

## Business rules

UI closeout contract/B07. Opening cannot be entered at closing; negative variance remains visible.

## Implementation steps

1. Replace legacy opening-at-close form with shift-based wizard.
2. Add guarded /operations/closeouts queue/detail and navigation.
3. Render pending work, discrepancy, reviewer history and immutable versions.
4. Test loading/empty/denied/flag/clarification/approved and keyboard flows.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Draft count unsaved, queue changes during preview, own review, zero-sales shift, late records.

## Tests

V21,V24,V25,V26 via E2E. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Cashier submits accurate fixed report; admin sees evidence and can independently review with clear variance. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/closeout-review.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

