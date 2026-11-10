# T47 — Create nonfiscal shopping-list snapshots and browser layout

**Status:** In progress; immutable snapshot and browser layout are implemented, with task dependencies and verification still open.  
**Task ID:** T47  
**Feature:** Shopping-list printing  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T01](./T01_add-guarded-enhancement-test-harness.md)

## Objective

Shopping list can preview/print in browser with correct units and both widths without modifying fiscal receipt output.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/pages/RestockingPage.tsx`
- `kodigo-ui/src/lib/receipt-print.ts`
- `kodigo-ui/src/lib/receipt-markup.ts`
- `kodigo-ui/scripts/unit/receipt-print.test.mjs`

## Files to modify

- `kodigo-ui/src/lib/receipt-print.ts`
- `kodigo-ui/src/pages/RestockingPage.tsx`

## New files

- `kodigo-ui/src/types/shopping-lists.ts`
- `kodigo-ui/src/lib/shopping-lists.ts`
- `kodigo-ui/src/lib/shopping-list-markup.ts`
- `kodigo-ui/src/lib/document-print.ts`
- `kodigo-ui/scripts/unit/shopping-list-print.test.mjs`

## Database changes

None. Shopping-list document and attempt IDs are local non-sale identifiers; no fiscal receipt or stock writes.

## Backend work

None; no server printing subsystem.

## Frontend work

Snapshot selected receiving quantities/unit/cost/estimated flag, optional prices,32/48-column 58/80 profiles. Extract only generic iframe transport into document-print while preserving receipt DOM contract/output.

## Business rules

B10/UI shopping list contract; label NOT A SALES RECEIPT; no receipt number/drawer pulse. Existing text download retained.

## Implementation steps

1. Extract selected-item calculation into reusable immutable shopping-list snapshot without changing receiving math.
2. Build escaped/sanitized thermal markup for both widths and optional prices.
3. Extract generic single-flight browser transport, keeping receipt wrapper tests unchanged.
4. Test long/Unicode/control text, dynamic height and no fiscal fields.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Selection changes while preview open, estimated cost, zero quantity, long names, browser dialog cancellation indistinguishable.

## Tests

V49,V50; existing receipt-markup/print tests remain passing; new snapshot/markup unit fixtures. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Shopping list can preview/print in browser with correct units and both widths without modifying fiscal receipt output. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run test:unit; npm run typecheck; npm run lint
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

