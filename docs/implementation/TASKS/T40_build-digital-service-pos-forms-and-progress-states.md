# T40 — Build digital service POS forms and progress states

**Status:** Planned; implementation has not started.  
**Task ID:** T40  
**Feature:** Digital POS UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T37](./T37_configure-and-verify-e-load-sale-workflow.md), [T38](./T38_configure-and-verify-gcash-cash-in-workflow.md), [T39](./T39_configure-and-verify-gcash-cash-out-workflow.md)

## Objective

Cashier sees exact direction/fee/earning and cannot present unverified digital transfer as complete.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/components/pos/ProductSearchPanel.tsx`
- `kodigo-ui/src/components/inventory/ProductForm.tsx`

## Files to modify

- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/components/inventory/ProductForm.tsx`

## New files

- `kodigo-ui/src/components/pos/DigitalServiceDialog.tsx`
- `kodigo-ui/src/components/pos/DigitalServiceProgress.tsx`
- `kodigo-ui/tests/e2e/digital-services.spec.ts`

## Database changes

No new tables; nonstock catalog uses checked T32 admin APIs; no generic direct table writes.

## Backend work

Add ordinary digital-product confirmed delivery command through T36 using explicit sale price/cost and approved classification; no invented provider/commission.

## Frontend work

Products/services selector, load/cashin/cashout forms, one policy preview, wallet/cash/earnings effects, provider evidence steps, pending/unknown/error states and online-only gate.

## Business rules

UI digital contract/B08. Existing GCash retail tender preserved; digital success requires required legs; draft offline has no transfer.

## Implementation steps

1. Add nonstock catalog form controls with explicit kind/cost/face settings.
2. Build step form preserving server quote and operation across retries.
3. Display actual completed legs/clearing liability and unknown-outcome escalation.
4. Test each service and generic digital product, fee replacement, insufficient funds and offline restriction.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Double click, policy changes, recipient altered after reserve, provider offline, ordinary product stock behavior.

## Tests

V27–V34,V41 via E2E plus generic nonstock sale accounting. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Cashier sees exact direction/fee/earning and cannot present unverified digital transfer as complete. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/digital-services.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

