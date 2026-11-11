# T39 — Configure and verify GCash cash-out workflow

**Status:** In progress; cash-out quote and manual-record source are applied, but payout recovery and required verification are pending.  
**Task ID:** T39  
**Feature:** GCash cash-out  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T36](./T36_implement-manual-digital-service-step-orchestration.md)

## Objective

Cash-out never claims complete without incoming verification and physical payout; cash cannot go negative.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/digital-services.ts`
- `kodigo-ui/src/lib/digital-service-quotes.ts`

## Files to modify

- `kodigo-ui/src/lib/digital-services.ts`

## New files

- `supabase/tests/enhancements/T39_gcash_cashout.sql`
- Combined CLI-generated migration for T32–T42 schema/source: `supabase/migrations/20261111120227_t32_t42_manual_digital_services.sql`, applied to the existing project as history version `20261111130705`; checksum and verification are in SCHEMA_BASELINE/TASK_STATUS.

## Database changes

Use M10 cash-out step configuration; outgoing drawer hold, verified incoming wallet and payout source uniqueness.

## Backend work

Reserve physical principal; verify customer incoming GCash face+fee before payout; post wallet+observed receipt, then cash−face after physical exchange; earning fee after both. Bill fee only, link its payment to verified incoming fee slice and retain principal in clearing; no double payout on retry.

## Frontend work

Expose customer-transfers/receives/wallet+/cash−/fee fields for T40.

## Business rules

B08 boundaries and PHP500→504 wallet/−500 cash/4 earning. Alternate2% replaces flat.

## Implementation steps

1. Bind cash-out fee band/reservation and incoming-first sequence.
2. Require confirmed incoming amount/ref before enabling payout command.
3. Post actual cash disbursement once, reconcile uncertain outcome.
4. Test fee thresholds, cash shortage, duplicate refs and interrupted payout.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Below50 default, customer sent principal without fee, insufficient physical cash, incoming confirmed but cashier unsure payout.

## Tests

V23,V29,V30,V32,V33,V41. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Cash-out never claims complete without incoming verification and physical payout; cash cannot go negative. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T39
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

