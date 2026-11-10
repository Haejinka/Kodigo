# T21 — Implement credit and capture allocation for refunds

**Status:** Planned; implementation has not started.  
**Task ID:** T21  
**Feature:** Refund validation  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T20](./T20_add-refund-reservations-approval-and-settlement-schema.md), [T18](./T18_record-accepted-returns-and-credits-without-automatic-refund.md)

## Objective

Confirmed+reserved refund never exceeds eligible credit or paid amount and never restores stock.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/sale-credits.ts`
- `kodigo-ui/src/lib/transactions.ts`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T21_refund_allocation.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t21_refund_capacity_service.sql`. Run the pinned CLI's verified `migration new t21_refund_capacity_service` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M06 allocation/hold rows and deferred credit/payment sum checks; original-sale locks bound confirmed+reserved capacity.

## Backend work

request_sale_refund/approve_sale_refund/get_refund_eligibility; create goodwill credit for explicit payment-only allowance, or consume existing accepted credit. Same source cannot be credited twice.

## Frontend work

Adapters return original method, available credit/capture and exact amount quote for T23.

## Business rules

B02/B03/B05. Monetary-only goodwill quantity0; deterministic cents; independent approver required for cash refund requests.

## Implementation steps

1. Lock sale, credit and payment capacity in common order.
2. Allocate requested amount to available credits/captures and reserve once.
3. Create zero-unit goodwill only when no existing credit covers approved allowance.
4. Reject concurrent excess, duplicate allocation and unauthorized method changes.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Full financial refund then later return, existing pending refund, final cent, zero captured payment, rejected request releasing hold.

## Tests

V15–V19; credit and capture capacity each independently enforced. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Confirmed+reserved refund never exceeds eligible credit or paid amount and never restores stock. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T21
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

