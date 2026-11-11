# T38 — Configure and verify GCash cash-in workflow

**Status:** In progress; cash-in quote and manual-record source are applied, but staged recovery and required verification are pending.  
**Task ID:** T38  
**Feature:** GCash cash-in  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T36](./T36_implement-manual-digital-service-step-orchestration.md)

## Objective

Cash-in posts physical and GCash legs correctly with one fee and no stock change.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/digital-services.ts`
- `kodigo-ui/src/lib/digital-service-quotes.ts`

## Files to modify

- `kodigo-ui/src/lib/digital-services.ts`

## New files

- `supabase/tests/enhancements/T38_gcash_cashin.sql`
- Combined CLI-generated migration for T32–T42 schema/source: `supabase/migrations/20261111120227_t32_t42_manual_digital_services.sql`, applied to the existing project as history version `20261111130705`; checksum and verification are in SCHEMA_BASELINE/TASK_STATUS.

## Database changes

Use M10 cash-in step configuration and M09 single selected fee snapshot.

## Backend work

Reserve outgoing GCash face, collect physical face+fee, verify outgoing transfer/ref, post wallet−face and complete earning fee. Alternate2% replaces3%. Billed amount is fee only; payment_cash_links allocate fee to existing cash collection and principal stays clearing, without second cash posting.

## Frontend work

Return explicit customer-pays/cash+/GCash−/earning fields for T40.

## Business rules

B08 PHP100→cash103/wallet−100/earning3. Provider failure after collection leaves refund liability.

## Implementation steps

1. Bind cash-in quote/reservation and collect-before-provider state.
2. Enforce exact amount/account/reference evidence and wallet direction.
3. Complete and release clearing once verified; retain observed cash on failed delivery.
4. Test standard/alternative, insufficiency and duplicate confirmation.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Transfer wrong recipient/amount, cash collected then network lost, provider reference duplicate, wallet hold concurrent.

## Tests

V28,V30–V34,V41. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Cash-in posts physical and GCash legs correctly with one fee and no stock change. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T38
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

