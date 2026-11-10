# T49 — Add shopping-list preview print and explicit reprint UI

**Status:** In progress; preview, explicit refresh, browser/native selection, and status reporting are implemented, pending deployed verification.  
**Task ID:** T49  
**Feature:** Shopping-list workflow  
**Priority:** Medium  
**Estimated complexity:** S (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T47](./T47_create-nonfiscal-shopping-list-snapshots-and-browser-layout.md), [T48](./T48_extend-existing-native-agent-with-a-shopping-list-endpoint.md)

## Objective

Users can print selected shopping list at supported widths with clear status and duplicate protection.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/pages/RestockingPage.tsx`
- `kodigo-ui/src/components/receipts/ReceiptPreviewModal.tsx`
- `kodigo-ui/src/lib/hardware.ts`

## Files to modify

- `kodigo-ui/src/pages/RestockingPage.tsx`

## New files

- `kodigo-ui/src/components/shopping/ShoppingListPreviewDialog.tsx`
- `kodigo-ui/tests/e2e/shopping-list-print.spec.ts`

## Database changes

None.

## Backend work

Use native capability route or generic browser transport; no business API.

## Frontend work

Selected items→snapshot→58/80 preview, prices toggle, printer/browser option, refresh snapshot, active disable, Submitted to Windows/Dialog opened states and explicit reprint; retain TXT download.

## Business rules

B10/UI shopping list contract. No automatic retry on ambiguous physical printing; no sale or stock effect.

## Implementation steps

1. Add preview action alongside existing text export.
2. Persist stable document/attempt IDs for unchanged preview and explicit new ID on refresh.
3. Wire capability-aware native/browser fallback and errors.
4. Test double click, cancelled/dialog return, offline/old agent and reprint wording.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Preview items changed in background, printer selected unsupported width, user closes while printing, native unavailable.

## Tests

V49,V50 via E2E and unit regression; assert no receipt/drawer endpoint calls. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Users can print selected shopping list at supported widths with clear status and duplicate protection. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/shopping-list-print.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

