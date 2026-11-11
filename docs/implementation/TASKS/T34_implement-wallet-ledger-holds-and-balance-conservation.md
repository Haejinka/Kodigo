# T34 — Implement wallet ledger holds and balance conservation

**Status:** In progress; wallet ledger and adjustment schema/source are applied, but service holds and required verification are pending.  
**Task ID:** T34  
**Feature:** Wallet accounting  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T32](./T32_add-nonstock-service-catalog-and-digital-account-models.md), [T33](./T33_implement-immutable-fee-policy-versions-and-exact-quotes.md)

## Objective

No unauthorized negative wallet or duplicate effect; all balances trace to explicit movements.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/pos-operations.ts`
- `kodigo-ui/src/types/digital-services.ts`

## Files to modify

None.

## New files

- `kodigo-ui/src/lib/wallets.ts`
- `supabase/tests/enhancements/T34_wallet_ledger.sql`
- Combined CLI-generated migration for T32–T42 schema/source: `supabase/migrations/20261111120227_t32_t42_manual_digital_services.sql`, applied to the existing project as history version `20261111130705`; checksum and verification are in SCHEMA_BASELINE/TASK_STATUS.

## Database changes

M09 wallet movements/reservations, immutable source uniqueness, amount arithmetic, nonnegative posted/available; balances start from evidenced opening operation.

## Backend work

Private wallet post/reserve/consume/release and guarded account/history reads. Locks wallet IDs deterministically. Opening/topup uses explicit evidence, no inferred balance.

## Frontend work

Posted/reserved/available typed adapter, no direct balance mutation.

## Business rules

B08. Load/GCash/cash separate; holds not movements; unknown outcome does not release funds.

## Implementation steps

1. Add ledger/hold constraints and immutable guards.
2. Implement idempotent posting/holds and source/account/type validation.
3. Add balance+statement read/reconciliation query.
4. Test parallel deductions, insufficient funds and no commission topup.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Two services same wallet, duplicate reference under different operation, reservation expired but outcome unknown.

## Tests

V27,V31–V35; SQL wallet>=0 and sum conservation; cross-domain invariants in T58. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

No unauthorized negative wallet or duplicate effect; all balances trace to explicit movements. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T34
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

