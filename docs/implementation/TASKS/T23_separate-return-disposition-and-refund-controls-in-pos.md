# T23 — Separate return disposition and refund controls in POS

**Status:** Planned; implementation has not started.  
**Task ID:** T23  
**Feature:** Return/refund UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T19](./T19_apply-return-disposition-and-inspection-transfers-to-source-lots.md), [T22](./T22_confirm-refunds-with-independent-cash-or-external-settlement.md)

## Objective

Users can explain what goods came back, where they went and whether money was returned; pending actions clearly labeled.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`
- `kodigo-ui/src/lib/transactions.ts`
- `kodigo-ui/src/components/ui/dialog.tsx`

## Files to modify

- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`

## New files

- `kodigo-ui/src/components/pos/ReturnIntakeDialog.tsx`
- `kodigo-ui/src/components/pos/RefundDialog.tsx`
- `kodigo-ui/src/components/inventory/ReturnInspectionDialog.tsx`
- `kodigo-ui/tests/e2e/returns-refunds.spec.ts`

## Database changes

No new schema; T17–T22 read/write APIs only.

## Backend work

No browser monetary entitlement or stock mutation logic.

## Frontend work

Sold/previous/eligible quantities, explicit per-line disposition, separate credit and refund state, inspection actions and settlement evidence; add Returns/Credits and Payments detail panels.

## Business rules

B03/B05 and UI return/refund specification. Default return quantity0; refund never assumed from intake.

## Implementation steps

1. Replace restock boolean/default full-return form with eligible quantities and disposition.
2. Show accepted credit/refund due independently of payment confirmation.
3. Add refund request/approve/confirm flow with original-method/current-drawer context.
4. Test pending/failed/denied/stale/fully-refunded physical-return screens and focus.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Concurrent return, no available credit, refunded but goods outstanding, unknown external status, missing original product.

## Tests

V11–V20,V26 via browser plus negative authorization API. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Users can explain what goods came back, where they went and whether money was returned; pending actions clearly labeled. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/returns-refunds.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

