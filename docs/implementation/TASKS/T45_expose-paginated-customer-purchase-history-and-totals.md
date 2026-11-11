# T45 — Expose paginated customer purchase history and totals

**Status:** Planned; implementation has not started.  
**Task ID:** T45  
**Feature:** Customer history  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T43](./T43_add-store-scoped-customer-identity-without-rewriting-history.md), [T09](./T09_correct-reporting-discount-basis-and-share-financial-facts.md), [T18](./T18_record-accepted-returns-and-credits-without-automatic-refund.md), [T22](./T22_confirm-refunds-with-independent-cash-or-external-settlement.md), [T44](./T44_add-customer-profile-screens-and-optional-checkout-selection.md)

## Objective

Customer totals reconcile to canonical facts and history stays efficient/paginated.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/customers.ts`
- `kodigo-ui/src/lib/reporting.ts`
- `kodigo-ui/src/pages/CustomersPage.tsx`

## Files to modify

- `kodigo-ui/src/lib/customers.ts`
- `kodigo-ui/src/pages/CustomersPage.tsx`

## New files

- `kodigo-ui/src/pages/CustomerDetailPage.tsx`
- `supabase/tests/enhancements/T45_customer_history.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t45_customer_purchase_history.sql`. Run the pinned CLI's verified `migration new t45_customer_purchase_history` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M11 guarded history/summary/top-items RPCs with store/customer/date timestamp+ID indexes and cursor≤100.

## Backend work

Return dated sales/items/quantities/discounts/credits/refunds/void/returns; aggregate gross/net billed/net paid/refund due and frequent net units via T08 facts without join multiplication.

## Frontend work

Customer detail profile/summary/history/item drill-down with date-basis labels and source links; no entire-history download.

## Business rules

B03/B10. Voids net0; returned credit and financial refund subtract once; history and rankings count only sales explicitly linked to that customer; guest sales remain unlinked with separate guest totals. Prior financial refund does not hide physical return.

## Implementation steps

1. Build stable keyset history and backend aggregate queries.
2. Return fact version/ambiguity indicators and separate money/quantity states.
3. Render detail screen with loading/empty/error/denied and cursor paging.
4. Reconcile summary to known customer fixtures including partial return/refund/void.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Equal timestamps, many lines/payments/credits per sale, unknown legacy basis, archived profile, customer has no sales.

## Tests

V17,V45–V47; bounded page results, index plan on large synthetic fixture. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Customer totals reconcile to canonical facts and history stays efficient/paginated. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T45
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

