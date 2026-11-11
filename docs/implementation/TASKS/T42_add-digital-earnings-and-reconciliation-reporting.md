# T42 — Add digital earnings and reconciliation reporting

**Status:** In progress; earning-event schema is applied and recent screen summary exists, but reporting and reconciliation UI are pending.  
**Task ID:** T42  
**Feature:** Digital reports  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T35](./T35_add-wallet-funding-and-statement-reconciliation-controls.md), [T41](./T41_implement-evidence-based-digital-reversal-cases.md), [T09](./T09_correct-reporting-discount-basis-and-share-financial-facts.md)

## Objective

Retailer can reconcile three distinct balances and earnings without treating digital principal as product sales.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/pages/ReportsPage.tsx`
- `kodigo-ui/src/lib/reporting.ts`
- `kodigo-ui/src/lib/consignment-calculations.ts`
- `kodigo-ui/src/pages/WalletsPage.tsx`
- `kodigo-ui/src/App.tsx`

## Files to modify

- `kodigo-ui/src/pages/ReportsPage.tsx`
- `kodigo-ui/src/lib/reporting.ts`
- `kodigo-ui/src/pages/WalletsPage.tsx`
- `kodigo-ui/src/App.tsx`

## New files

- `kodigo-ui/src/pages/ReconciliationPage.tsx`
- `supabase/tests/enhancements/T42_service_reports.sql`
- Combined CLI-generated migration for T32–T42 schema/source: `supabase/migrations/20261111120227_t32_t42_manual_digital_services.sql`, applied to the existing project as history version `20261111130705`; checksum and verification are in SCHEMA_BASELINE/TASK_STATUS.

## Database changes

Guarded paginated service/account/earning/clearing summary functions; indexes store/date/account/state; no materialized job dependency.

## Backend work

Aggregate principal turnover, load cost/commission, fees, actual cash/wallet flows, pending liabilities and reversals separately; share closeout service subtotal definitions.

## Frontend work

Service report/export tab, wallet statement drill-down and /operations/reconciliation queue; preserve consignment and ordinary product metrics.

## Business rules

B03/B08. GCash principal not merchandise revenue/customer net spending; bill fee only and count each observed cash/provider leg once. E-load retail face and discounted cost distinct from commission earning. Receipt-based consignment payable unchanged.

## Implementation steps

1. Define fact-basis queries over posted step/earning events, not service totals duplicated per join.
2. Add date/account/service/state filters and bounded pages/export.
3. Integrate closeout subtotal parity and visible unresolved cases.
4. Test daily examples, partial cases, reversals and no double count in general sales.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Service completed on different day than cash leg, late evidence, fee policy version change, load wallet versus GCash wallet.

## Tests

V27–V35,V48; daily earning and wallet/cash sums reconcile to ledgers. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Retailer can reconcile three distinct balances and earnings without treating digital principal as product sales. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T42
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

