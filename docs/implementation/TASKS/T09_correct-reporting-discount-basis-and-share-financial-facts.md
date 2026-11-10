# T09 — Correct reporting discount basis and share financial facts

**Status:** Planned; implementation has not started.  
**Task ID:** T09  
**Feature:** Reporting correctness  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md)

## Objective

Summary/line/product totals reconcile for current and proven legacy formats; existing rankings remain product rankings.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/reporting.ts`
- `kodigo-ui/src/lib/reporting-calculations.ts`
- `kodigo-ui/src/pages/RankingsPage.tsx`
- `kodigo-ui/src/pages/DashboardPage.tsx`
- `kodigo-ui/src/pages/AnalyticsPage.tsx`
- `kodigo-ui/scripts/unit/reporting-calculations.test.mjs`
- `migration_40_inventory_consumption_history.sql`

## Files to modify

- `kodigo-ui/src/lib/reporting.ts`
- `kodigo-ui/src/lib/reporting-calculations.ts`
- `kodigo-ui/scripts/unit/reporting-calculations.test.mjs`

## New files

- `supabase/tests/enhancements/T09_reporting_basis.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t09_reporting_fact_adapters.sql`. Run the pinned CLI's verified `migration new t09_reporting_fact_adapters` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Replace/guard v_product_rankings, v_sales_by_selling_option and consumption readers to use normalized versioned facts/category mapping; preserve tenant access.

## Backend work

Backend summary/product aggregate reads share T08; audit all consumers and retain explicit settlement-period versus original-sale-period basis.

## Frontend work

Remove second discount for modern net lines; retain legacy adapter; label net billed/net paid where both shown. Keep product ranking screen and export formats usable.

## Business rules

B02/B03/B10; discounts exactly once, return units distinct from refund money, damaged COGS unrecovered.

## Implementation steps

1. Add failing PHP100 gross/10 discount fixture showing net90 at line and summary.
2. Migrate report adapters and SQL views to normalized facts; remove duplicate subtraction only by proven version.
3. Check dashboard/analytics/rank/export and movement category consumers.
4. Compare legacy/current report fixture totals and unknown banners.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Product filters, line-level allocations, voided legacy payments, return without refund, refund without goods.

## Tests

V17,V18,V45,V47; extend current unit suite and SQL fact parity. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Summary/line/product totals reconcile for current and proven legacy formats; existing rankings remain product rankings. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T09
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

