# T27 — Add shift opening and authorized cash movement UI

**Status:** Planned; implementation has not started.  
**Task ID:** T27  
**Feature:** Cashier cash UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T25](./T25_post-append-only-physical-cash-movements-and-holds.md), [T26](./T26_bind-checkout-void-and-refund-cash-to-real-shifts.md)

## Objective

Opening is recorded before sale; physical cash additions/removals are explained and authorized.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`
- `kodigo-ui/src/components/layout/Topbar.tsx`

## Files to modify

- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`

## New files

- `kodigo-ui/src/components/pos/ShiftOpenDialog.tsx`
- `kodigo-ui/src/components/pos/CashMovementPanel.tsx`
- `supabase/tests/enhancements/T27_manual_cash.sql`
- `kodigo-ui/tests/e2e/cash-movements.spec.ts`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t27_manual_cash_commands.sql`. Run the pinned CLI's verified `migration new t27_manual_cash_commands` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Use M07 ledger and M01 operational_approval_requests/decisions; no freely editable cash balance. Request/decision source is linked to final movement operation.

## Backend work

request/approve/record_cash_movement APIs with amount, type, reason, independent approval for adjustments/thresholds, current custody and source uniqueness.

## Frontend work

Opening declaration, current posted/available/holds, add/remove/drop/adjust request, chronological cash history and keyboard forms.

## Business rules

B01/B07. All manual adjustments require independent admin approval by default; D06 may refine thresholds later.

## Implementation steps

1. Add command validation and pending approval semantics before posting.
2. Add opening gate and current shift/drawer indicator in POS.
3. Build movement form/history with signed before-after and reference.
4. Exercise cash shortage, duplicate submit, denied and offline-disabled states.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Negative variance cannot be fixed with silent adjustment, cashier changes drawer, hardware open without cash effect.

## Tests

V21,V22,V23,V52 plus UI states. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Opening is recorded before sale; physical cash additions/removals are explained and authorized. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T27
npm run test:e2e -- tests/e2e/cash-movements.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

