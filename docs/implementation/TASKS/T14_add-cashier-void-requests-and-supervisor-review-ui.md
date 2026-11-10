# T14 — Add cashier void requests and supervisor review UI

**Status:** Planned; implementation has not started.  
**Task ID:** T14  
**Feature:** Void UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T12](./T12_implement-void-request-and-independent-decision-endpoints.md), [T13](./T13_apply-full-void-with-source-stock-and-confirmed-money-reversal.md)

## Objective

Cashier can request, different authorized employee can review, and pending requests never look applied.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`
- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## Files to modify

- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## New files

- `kodigo-ui/src/components/pos/VoidRequestDialog.tsx`
- `kodigo-ui/src/pages/VoidApprovalsPage.tsx`
- `kodigo-ui/tests/e2e/void-approval.spec.ts`

## Database changes

No new tables; use T11–T13 RPCs.

## Backend work

No duplicated policy/calculation in browser.

## Frontend work

Eligibility, reason/held-goods attestation, request badge, /operations/voids queue and review/evidence. Own approval disabled with explanation; rejected and pending settlement visibly distinct.

## Business rules

UI POS void contract/B04; no optimistic stock/cash change.

## Implementation steps

1. Replace direct void button with request dialog.
2. Add guarded supervisor/admin queue route and navigation.
3. Show decision/evidence/application history and linked movements.
4. Exercise loading/empty/error/denied/unknown settlement and keyboard focus.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Permission revoked while dialog open, stale eligibility, duplicate click, server timeout after applied.

## Tests

V06,V07,V09,V10 authority flow via E2E. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Cashier can request, different authorized employee can review, and pending requests never look applied. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/void-approval.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

