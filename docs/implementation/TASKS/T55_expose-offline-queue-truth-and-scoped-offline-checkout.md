# T55 — Expose offline queue truth and scoped offline checkout

**Status:** Planned; implementation has not started.  
**Task ID:** T55  
**Feature:** Offline POS UI  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T54](./T54_unify-retry-scheduling-and-multi-tab-synchronization.md), [T26](./T26_bind-checkout-void-and-refund-cash-to-real-shifts.md), [T52](./T52_reserve-per-terminal-product-and-lot-stock-for-offline-sales.md)

## Objective

Cashier always knows whether sale exists only locally or on server and can find failed/pending work.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/stores/cartStore.ts`

## Files to modify

- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/pages/POSPage.tsx`
- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/stores/cartStore.ts`

## New files

- `kodigo-ui/src/components/pos/SyncQueuePanel.tsx`
- `kodigo-ui/src/components/pos/OfflineStatusBadge.tsx`
- `kodigo-ui/tests/e2e/offline-pos.spec.ts`

## Database changes

No new tables; reads local queue and server ack/conflict contracts.

## Backend work

No client bypass of grant/lease/pricing policy.

## Frontend work

Partitioned cached catalog, local stock from grants, cash-only completion, clear recorded-local/confirmed distinction, pending/synchronized/conflicted/auth/recovery views, stale time/lease/grant indicator and safe retry.

## Business rules

B09/UI queue contract. Persist before clear; provisional nonfiscal record only; no automatic official reprint/drawer pulse after sync.

## Implementation steps

1. Gate offline completion by supported item/tender/lease/grant and local durable write.
2. Render explicit local confirmation with provisional ID and server receipt only after ack.
3. Add queue status/history/details/retry with actor privacy and storage-failure handling.
4. Test queue visibility, no digital completion, exhausted stock, new cashier and no misleading success.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Quota failure, partial local write, accepted server but ack pending, offline noncash tender, device unlock expired.

## Tests

V36–V43,V37,V41; user-visible labels and no silent discard. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Cashier always knows whether sale exists only locally or on server and can find failed/pending work. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e -- tests/e2e/offline-pos.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

