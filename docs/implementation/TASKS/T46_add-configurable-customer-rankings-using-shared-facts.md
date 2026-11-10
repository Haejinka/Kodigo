# T46 — Add configurable customer rankings using shared facts

**Status:** Planned; implementation has not started.  
**Task ID:** T46  
**Feature:** Customer rankings  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T45](./T45_expose-paginated-customer-purchase-history-and-totals.md)

## Objective

Customer rankings are configurable and explainable without altering product rankings.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/pages/RankingsPage.tsx`
- `kodigo-ui/src/lib/customers.ts`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## Files to modify

- `kodigo-ui/src/lib/customers.ts`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## New files

- `kodigo-ui/src/pages/CustomerRankingsPage.tsx`
- `supabase/tests/enhancements/T46_customer_rankings.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t46_customer_rankings.sql`. Run the pinned CLI's verified `migration new t46_customer_rankings` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Guarded aggregate rank RPC with metric whitelist, store/date filters, deterministic metric+customer UUID cursor; no cross-store identity merge.

## Backend work

Net spending/net units/distinct transaction visits/recent nonvoid purchase per B10. No double count from refunds/returns; frequent metric explicitly visits per chosen period.

## Frontend work

Separate /customers/rankings route, metric/date filters, guest aggregate card and displayed definition; preserve existing /rankings product page.

## Business rules

B10. Fully returned visit remains historical transaction, fully voided excluded; monetary goodwill changes spend but not quantity.

## Implementation steps

1. Implement whitelisted metric queries and stable tie cursor.
2. Compare against T45 customer summary fixtures.
3. Reuse product ranking visual conventions for separate customer page.
4. Test all metrics after returns/refunds/voids and access denial.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Ties, negative legacy net anomaly, no activity, guest sales, refund posted outside original sale period.

## Tests

V45,V46,V47; ranking order/totals correct and deterministic. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Customer rankings are configurable and explainable without altering product rankings. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T46
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

