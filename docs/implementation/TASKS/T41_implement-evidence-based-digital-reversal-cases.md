# T41 — Implement evidence-based digital reversal cases

**Status:** Planned; implementation has not started.  
**Task ID:** T41  
**Feature:** Digital recovery  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T37](./T37_configure-and-verify-e-load-sale-workflow.md), [T38](./T38_configure-and-verify-gcash-cash-in-workflow.md), [T39](./T39_configure-and-verify-gcash-cash-out-workflow.md), [T22](./T22_confirm-refunds-with-independent-cash-or-external-settlement.md)

## Objective

Internal records reconcile with actual external state and cannot duplicate refunds/transfers/commissions.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/digital-services.ts`
- `kodigo-ui/src/lib/refunds.ts`
- `kodigo-ui/src/lib/wallets.ts`

## Files to modify

- `kodigo-ui/src/lib/digital-services.ts`

## New files

- `supabase/tests/enhancements/T41_digital_reversals.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t41_digital_reversal_reconciliation.sql`. Run the pinned CLI's verified `migration new t41_digital_reversal_reconciliation` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M10 reversal requests/events/cases with linked original step and compensating wallet/cash/earning/clearing facts; unique reversed-leg source bounds.

## Backend work

Request/review/record_verified_reversal; only actual reversed external/cash leg compensated. Irreversible load stays case/refund liability under explicit policy; supervisor approval is not provider reversal.

## Frontend work

Adapter exposes allowed actions/evidence/partial reversal; no generic undo button.

## Business rules

B03/B08. Unknown never resubmitted; earned commission reversed only once against verified unwind.

## Implementation steps

1. Enumerate original observed legs and remaining reversible amounts.
2. Record independent decision and external evidence before compensating account effects.
3. Post each verified compensation once; retain unreversed liability/partial state.
4. Test failed delivery refund, irreversible load, partial GCash and duplicate external reversal reference.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Wallet depleted after original transfer, insufficient cash for refund, one leg irreversible, old closeout approved.

## Tests

V10,V20,V32–V35,V26; no fictional all-leg rollback. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Internal records reconcile with actual external state and cannot duplicate refunds/transfers/commissions. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T41
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

