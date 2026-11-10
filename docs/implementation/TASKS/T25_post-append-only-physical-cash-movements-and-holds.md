# T25 — Post append-only physical cash movements and holds

**Status:** Planned; implementation has not started.  
**Task ID:** T25  
**Feature:** Cash accounting  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T24](./T24_register-terminals-drawers-and-real-shift-opening.md)

## Objective

Expected drawer cash can be recomputed from immutable physical movements and no unauthorized negative balance occurs.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_19_transaction_lifecycle_auth_ops.sql`
- `kodigo-ui/src/lib/cash-drawers.ts`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T25_cash_ledger.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t25_cash_movements_and_reservations.sql`. Run the pinned CLI's verified `migration new t25_cash_movements_and_reservations` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M07 cash_movements/reservations/payment_cash_links/payment_service_links, ledger sequence, unique operation-source, arithmetic and nonnegative available projection. Counts are zero-delta observations only; payment links permit fee slice of preposted principal+fee cash.

## Backend work

post_cash_movement and reserve/consume/release cash helpers; complete shift opening positive movement; expected cash computed from movement ledger, independent of sale status.

## Frontend work

Return posted/reserved/available balances for later forms; no optimistic changes.

## Business rules

B07. Tender minus change once; noncash zero movement; negative outflow requires actual sufficient available cash; hardware pulse unrelated.

## Implementation steps

1. Create ledger/hold schema and immutable guards.
2. Implement locked posting/reservation with exact source effect identity.
3. Post opening once and expose current balance/history reads.
4. Test cash sale/refund/drop/adjustment/count and insufficient concurrent outflows.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Duplicate opening, refund different employee, late original-shift cash, closeout count mistakenly counted as inflow.

## Tests

V21–V24,V26; opening500+100+50−20−10=620 and card200 excluded. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Expected drawer cash can be recomputed from immutable physical movements and no unauthorized negative balance occurs. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T25
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

