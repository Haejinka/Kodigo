# T22 — Confirm refunds with independent cash or external settlement

**Status:** Planned; implementation has not started.  
**Task ID:** T22  
**Feature:** Refund execution  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T21](./T21_implement-credit-and-capture-allocation-for-refunds.md), [T25](./T25_post-append-only-physical-cash-movements-and-holds.md)

## Objective

Money reversal posts exactly once to performing custody/account, with no invented external reversal.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `supabase/migrations/20261021100000_fix_refund_pos_sale_refund_total.sql`
- `kodigo-ui/src/lib/transactions.ts`

## Files to modify

- `kodigo-ui/src/lib/transactions.ts`

## New files

- `kodigo-ui/src/lib/refunds.ts`
- `supabase/tests/enhancements/T22_refund_settlement.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t22_refund_settlement_service.sql`. Run the pinned CLI's verified `migration new t22_refund_settlement_service` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Confirmed M06 events plus immutable negative payment and M07 cash effect; no original capture mutation. Unknown external evidence retained with holds.

## Backend work

confirm_sale_refund/record_refund_external_outcome; cash requires actual current shift/approval/sufficient cash, noncash verified original-method settlement. Closed-sale link allowed via T31 adjustment integration.

## Frontend work

Typed confirmed/pending/unknown adapters; old refund_pos_sale delegates same guards or returns upgrade-required.

## Business rules

B03/B05/B07. No automatic stock effect; no blind provider retry; credit net billed already changed once.

## Implementation steps

1. Revalidate approval/method/hold under sale then current-shift locks.
2. For cash post payment+cash+settlement+audit atomically after payout attestation.
3. For noncash record only verified effect; unknown retains hold and pending state.
4. Retire bypass signatures, force failure and response-loss retries.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Refunding employee differs from original cashier, closed old sale, cash shortage, provider duplicate ref, method change.

## Tests

V16,V17,V19,V20,V23,V26,V52; zero inventory movement on financial-only refund. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Money reversal posts exactly once to performing custody/account, with no invented external reversal. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T22
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

