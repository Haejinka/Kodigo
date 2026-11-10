# T26 — Bind checkout void and refund cash to real shifts

**Status:** Planned; implementation has not started.  
**Task ID:** T26  
**Feature:** POS accounting integration  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T06](./T06_route-all-existing-stock-writers-through-the-ledger.md), [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md), [T13](./T13_apply-full-void-with-source-stock-and-confirmed-money-reversal.md), [T22](./T22_confirm-refunds-with-independent-cash-or-external-settlement.md), [T25](./T25_post-append-only-physical-cash-movements-and-holds.md)

## Objective

Every new confirmed physical sale has consistent stock/payment/cash/receipt records and UI never equates queued with server-confirmed.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/lib/transactions.ts`
- `kodigo-ui/src/stores/cartStore.ts`

## Files to modify

- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/lib/transactions.ts`

## New files

- `supabase/tests/enhancements/T26_shift_sale_accounting.sql`
- `kodigo-ui/scripts/unit/sale-result-state.test.mjs`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t26_bind_pos_accounting_to_shifts.sql`. Run the pinned CLI's verified `migration new t26_bind_pos_accounting_to_shifts` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Add same-store shift/terminal/accounting version fields to sales/payments and v5 required-fact deferred checks. All new confirmed cash sale/void/refund effects require M07 source uniqueness.

## Backend work

Complete v5 command with open-shift validation, net line pricing, payment/receipt, inventory and cash atomicity. Every legacy process signature delegates or rejects upgrade; new confirmation cannot fall back to unsafe IDB v1.

## Frontend work

Require active custody before checkout; explicit server versus recorded-local result union. Keep peripheral printing errors separate from sale success.

## Business rules

B02/B03/B07/B09. Cash is net tender; card/GCash tender no cash movement; no completed sale without required facts.

## Implementation steps

1. Attach current registered shift/terminal command fields and validate server-side.
2. Post sale/cash/inventory/receipt as one idempotent operation using existing snapshot rules.
3. Switch PaymentModal to truthful result branch and preserve UUID across uncertain retries.
4. Test every old signature for policy bypass and all supported tender/peripheral failure paths.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Store changed mid-cart, shift closes during payment, commit response lost, printer unavailable, existing cached offline path.

## Tests

V01–V03,V21,V24,V38,V52; no duplicate cash or receipt. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Every new confirmed physical sale has consistent stock/payment/cash/receipt records and UI never equates queued with server-confirmed. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T26
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

